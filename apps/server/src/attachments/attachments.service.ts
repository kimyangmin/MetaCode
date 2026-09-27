import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AttachmentDto, CreateUploadRequest, UploadTicket } from '@metacode/shared';
import { AccessService } from '../chat/access.service.js';
import { uuidv7 } from '../common/uuid.js';
import type { Env } from '../config/env.js';
import type { Attachment, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { IMAGE_CONTENT_TYPES, SNIFF_BYTES, processImage, sniffRasterFormat } from './image.js';

/** presigned URL 유효 시간 (초) */
const UPLOAD_URL_TTL_SECONDS = 10 * 60;
const DOWNLOAD_URL_TTL_SECONDS = 10 * 60;
/** 메시지에 붙지 않은 첨부는 이 시간이 지나면 지운다 */
const ORPHAN_TTL_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

export const objectKeyFor = (channelId: string, id: string) => `attachments/${channelId}/${id}`;
const thumbnailKeyFor = (channelId: string, id: string) => `thumbnails/${channelId}/${id}.webp`;

export function toAttachmentDto(a: Attachment): AttachmentDto {
  return {
    id: a.id,
    fileName: a.fileName,
    contentType: a.contentType,
    size: a.size,
    kind: a.kind === 'IMAGE' ? 'image' : 'file',
    width: a.width,
    height: a.height,
  };
}

/**
 * Content-Disposition 값. 한글 파일 이름은 filename*(RFC 5987)로, 옛 브라우저용 filename에는
 * ASCII로 바꾼 이름을 넣는다.
 */
export function contentDisposition(type: 'inline' | 'attachment', fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * 첨부 파일 흐름
 * 1. createUpload: 권한과 크기를 확인하고, 그 크기만 올릴 수 있는 presigned PUT 주소를 준다.
 * 2. 브라우저가 저장소에 직접 올린다 (서버를 거치지 않음).
 * 3. complete: 실제로 올라왔는지, 크기가 맞는지 확인하고 이미지면 썸네일을 만든다 → READY
 * 4. 메시지를 보낼 때 claim으로 READY 첨부를 그 메시지에 붙인다.
 */
@Injectable()
export class AttachmentsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AttachmentsService.name);
  private readonly maxBytes: number;
  private cleanupTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly storage: StorageService,
    config: ConfigService<Env, true>,
  ) {
    this.maxBytes = config.get('UPLOAD_MAX_SIZE_MB', { infer: true }) * 1024 * 1024;
  }

  onModuleInit() {
    this.cleanupTimer = setInterval(() => void this.cleanupOrphans(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.cleanupTimer);
  }

  async createUpload(userId: string, request: CreateUploadRequest): Promise<UploadTicket> {
    const channel = await this.access.getChannel(userId, request.channelId);
    if (channel.type === 'VOICE')
      throw new BadRequestException('음성 채널에는 파일을 올릴 수 없습니다.');
    if (request.size > this.maxBytes) {
      throw new PayloadTooLargeException(
        `파일은 ${this.maxBytes / 1024 / 1024}MB까지 올릴 수 있습니다.`,
      );
    }

    const id = uuidv7();
    const objectKey = objectKeyFor(channel.id, id);
    await this.prisma.attachment.create({
      data: {
        id,
        channelId: channel.id,
        uploaderId: userId,
        objectKey,
        fileName: request.fileName,
        contentType: 'application/octet-stream',
        size: request.size,
      },
    });
    return {
      attachmentId: id,
      uploadUrl: await this.storage.presignPut(objectKey, request.size, UPLOAD_URL_TTL_SECONDS),
      headers: { 'Content-Type': 'application/octet-stream' },
      expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
    };
  }

  /** 업로드 확인. 이미 확인한 첨부면 그대로 돌려준다. */
  async complete(userId: string, attachmentId: string): Promise<AttachmentDto> {
    const attachment = await this.findOwn(userId, attachmentId);
    if (attachment.status === 'READY') return toAttachmentDto(attachment);

    const size = await this.storage.size(attachment.objectKey);
    if (size === null) throw new BadRequestException('파일이 아직 올라오지 않았습니다.');
    if (size !== attachment.size) {
      // 서명에 크기가 들어가 있어 정상적으로는 일어나지 않는다.
      await this.discard(attachment);
      throw new BadRequestException('올린 파일의 크기가 신고한 크기와 다릅니다.');
    }

    let data: Prisma.AttachmentUpdateInput = { status: 'READY' };
    const format =
      size >= 12
        ? sniffRasterFormat(await this.storage.readHead(attachment.objectKey, SNIFF_BYTES))
        : null;
    if (format) {
      const image = await processImage(await this.storage.read(attachment.objectKey));
      if (image) {
        const thumbnailKey = thumbnailKeyFor(attachment.channelId, attachment.id);
        await this.storage.write(thumbnailKey, image.thumbnail, 'image/webp');
        data = {
          ...data,
          kind: 'IMAGE',
          contentType: IMAGE_CONTENT_TYPES[format],
          width: image.width,
          height: image.height,
          thumbnailKey,
        };
      }
    }
    const updated = await this.prisma.attachment.update({ where: { id: attachment.id }, data });
    return toAttachmentDto(updated);
  }

  /** 보내기 전에 첨부를 뺐을 때 */
  async cancel(userId: string, attachmentId: string): Promise<void> {
    const attachment = await this.findOwn(userId, attachmentId);
    if (attachment.messageId) throw new BadRequestException('이미 보낸 첨부 파일입니다.');
    await this.discard(attachment);
  }

  /**
   * 메시지 트랜잭션 안에서 첨부를 그 메시지에 붙인다.
   * 내가 이 채널에 올려 확인까지 끝났고 아직 쓰지 않은 첨부만 붙일 수 있다.
   */
  async claim(
    tx: Prisma.TransactionClient,
    userId: string,
    channelId: string,
    attachmentIds: string[],
    messageId: string,
  ): Promise<void> {
    if (attachmentIds.length === 0) return;
    const { count } = await tx.attachment.updateMany({
      where: {
        id: { in: attachmentIds },
        uploaderId: userId,
        channelId,
        status: 'READY',
        messageId: null,
      },
      data: { messageId },
    });
    if (count !== attachmentIds.length) {
      throw new BadRequestException('첨부 파일을 찾을 수 없거나 이미 보낸 파일입니다.');
    }
  }

  /** 채널을 볼 수 있는 사람에게만 짧게 유효한 저장소 주소를 준다. */
  async downloadUrl(
    userId: string,
    attachmentId: string,
    options: { variant: 'original' | 'thumbnail'; download: boolean },
  ): Promise<string> {
    const attachment = await this.prisma.attachment.findUnique({ where: { id: attachmentId } });
    if (!attachment || attachment.status !== 'READY') throw notFound();
    await this.access.getChannel(userId, attachment.channelId);
    // 보내기 전 첨부는 올린 사람만 볼 수 있다 (입력창 미리보기).
    if (!attachment.messageId && attachment.uploaderId !== userId) throw notFound();

    const isImage = attachment.kind === 'IMAGE';
    if (options.variant === 'thumbnail' && attachment.thumbnailKey) {
      return this.storage.presignGet(
        attachment.thumbnailKey,
        {
          contentType: 'image/webp',
          disposition: contentDisposition('inline', attachment.fileName),
        },
        DOWNLOAD_URL_TTL_SECONDS,
      );
    }
    // 이미지가 아닌 파일은 항상 내려받게 한다 (HTML, SVG 등이 브라우저에서 실행되지 않도록).
    return this.storage.presignGet(
      attachment.objectKey,
      {
        contentType: isImage ? attachment.contentType : 'application/octet-stream',
        disposition: contentDisposition(
          isImage && !options.download ? 'inline' : 'attachment',
          attachment.fileName,
        ),
      },
      DOWNLOAD_URL_TTL_SECONDS,
    );
  }

  /** 커뮤니티를 지우기 전에 불러 둔다. DB는 연쇄 삭제되지만 저장소 파일은 따로 지워야 한다. */
  async keysInCommunity(communityId: string): Promise<string[]> {
    const attachments = await this.prisma.attachment.findMany({
      where: { channel: { communityId } },
      select: { objectKey: true, thumbnailKey: true },
    });
    return attachments.flatMap((a) => [a.objectKey, ...(a.thumbnailKey ? [a.thumbnailKey] : [])]);
  }

  async keysInChannel(channelId: string): Promise<string[]> {
    const attachments = await this.prisma.attachment.findMany({
      where: { channelId },
      select: { objectKey: true, thumbnailKey: true },
    });
    return attachments.flatMap((a) => [a.objectKey, ...(a.thumbnailKey ? [a.thumbnailKey] : [])]);
  }

  removeObjects(keys: string[]): Promise<void> {
    return this.storage.remove(keys);
  }

  /** 올리다 말았거나 보내지 않은 첨부(24시간 경과)를 지운다. 한 시간마다 돈다. */
  async cleanupOrphans(): Promise<number> {
    try {
      const orphans = await this.prisma.attachment.findMany({
        where: { messageId: null, createdAt: { lt: new Date(Date.now() - ORPHAN_TTL_MS) } },
        take: 1000,
      });
      if (orphans.length === 0) return 0;
      await this.prisma.attachment.deleteMany({ where: { id: { in: orphans.map((o) => o.id) } } });
      await this.storage.remove(orphans.flatMap(keysOf));
      this.logger.log(`보내지 않은 첨부 ${orphans.length}개를 지웠습니다.`);
      return orphans.length;
    } catch (error) {
      this.logger.warn(`첨부 정리 실패: ${(error as Error).message}`);
      return 0;
    }
  }

  private async findOwn(userId: string, attachmentId: string): Promise<Attachment> {
    const attachment = await this.prisma.attachment.findUnique({ where: { id: attachmentId } });
    if (!attachment || attachment.uploaderId !== userId) throw notFound();
    return attachment;
  }

  private async discard(attachment: Attachment): Promise<void> {
    await this.prisma.attachment.delete({ where: { id: attachment.id } });
    await this.storage.remove(keysOf(attachment));
  }
}

const keysOf = (a: Pick<Attachment, 'objectKey' | 'thumbnailKey'>) => [
  a.objectKey,
  ...(a.thumbnailKey ? [a.thumbnailKey] : []),
];

const notFound = () => new NotFoundException('첨부 파일을 찾을 수 없습니다.');
