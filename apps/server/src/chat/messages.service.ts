import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type MessageDto,
  type MessagePage,
  REPLY_PREVIEW_LENGTH,
  SocketEvent,
  isManager,
} from '@metacode/shared';
import { AttachmentsService, toAttachmentDto } from '../attachments/attachments.service.js';
import type { Attachment } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealtimeService, room } from '../realtime/realtime.service.js';
import { toProfile } from '../users/users.service.js';
import { AccessService } from './access.service.js';

type MessageRow = {
  id: string;
  channelId: string;
  content: string;
  forwarded: boolean;
  createdAt: Date;
  editedAt: Date | null;
  author: Parameters<typeof toProfile>[0];
  attachments: Attachment[];
  replyTo: {
    id: string;
    content: string;
    author: Parameters<typeof toProfile>[0];
    _count: { attachments: number };
  } | null;
};

/** 메시지와 함께 읽을 관계: 작성자, 첨부(올린 순서), 답장한 원래 메시지 */
const messageInclude = {
  author: true,
  attachments: { orderBy: { createdAt: 'asc' } },
  replyTo: { include: { author: true, _count: { select: { attachments: true } } } },
} as const;

export function toMessageDto(message: MessageRow): MessageDto {
  return {
    id: message.id,
    channelId: message.channelId,
    author: toProfile(message.author),
    content: message.content,
    attachments: message.attachments.map(toAttachmentDto),
    replyTo: message.replyTo
      ? {
          id: message.replyTo.id,
          author: toProfile(message.replyTo.author),
          content: Array.from(message.replyTo.content).slice(0, REPLY_PREVIEW_LENGTH).join(''),
          attachmentCount: message.replyTo._count.attachments,
        }
      : null,
    forwarded: message.forwarded,
    createdAt: message.createdAt.toISOString(),
    editedAt: message.editedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly realtime: RealtimeService,
    private readonly attachments: AttachmentsService,
  ) {}

  /**
   * 메시지를 저장하고 채널 방 전체에 message:created로 보낸다.
   * 채팅 모드와 메타버스 모드(말풍선)가 모두 이 이벤트 하나를 받는다.
   */
  async send(
    userId: string,
    channelId: string,
    content: string,
    attachmentIds: string[] = [],
    replyToId?: string,
  ): Promise<MessageDto> {
    const channel = await this.access.getChannel(userId, channelId);
    if (channel.type === 'VOICE')
      throw new BadRequestException('음성 채널에는 글을 쓸 수 없습니다.');
    // 답장은 같은 채널의 메시지에만 (다른 채널의 내용이 새어 나가지 않도록)
    if (replyToId) {
      const target = await this.prisma.message.findFirst({
        where: { id: replyToId, channelId },
        select: { id: true },
      });
      if (!target) throw new BadRequestException('답장할 메시지를 찾을 수 없습니다.');
    }

    // 첨부를 붙이지 못하면 메시지도 남기지 않는다.
    const message = toMessageDto(
      await this.prisma.$transaction(async (tx) => {
        const created = await tx.message.create({
          data: { channelId, authorId: userId, content, replyToId },
          select: { id: true },
        });
        await this.attachments.claim(tx, userId, channelId, attachmentIds, created.id);
        return tx.message.findUniqueOrThrow({ where: { id: created.id }, include: messageInclude });
      }),
    );
    this.realtime.emit(room.channel(channelId), SocketEvent.MessageCreated, message);
    return message;
  }

  /**
   * 메시지 전달: 볼 수 있는 메시지를 쓸 수 있는 다른 채널로. 보낸 사람은 전달한 사람이고, 첨부도 복사한다.
   */
  async forward(userId: string, messageId: string, channelId: string): Promise<MessageDto> {
    const source = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, channelId: true, content: true },
    });
    if (!source) throw new NotFoundException('메시지를 찾을 수 없습니다.');
    await this.access.getChannel(userId, source.channelId);
    const target = await this.access.getChannel(userId, channelId);
    if (target.type === 'VOICE')
      throw new BadRequestException('음성 채널에는 글을 쓸 수 없습니다.');

    const copies = await this.attachments.copyForForward(source.id, channelId, userId);
    const message = toMessageDto(
      await this.prisma.$transaction(async (tx) => {
        const created = await tx.message.create({
          data: { channelId, authorId: userId, content: source.content, forwarded: true },
          select: { id: true },
        });
        if (copies.length > 0) {
          await tx.attachment.createMany({
            data: copies.map((c) => ({ ...c, messageId: created.id })),
          });
        }
        return tx.message.findUniqueOrThrow({ where: { id: created.id }, include: messageInclude });
      }),
    );
    this.realtime.emit(room.channel(channelId), SocketEvent.MessageCreated, message);
    return message;
  }

  /**
   * 내가 보낸 메시지 고치기. 채팅 모드와 광장(떠 있는 말풍선)이 같은 message:updated를 받는다.
   * 첨부가 없는 메시지는 글을 비울 수 없다 (지우려면 삭제).
   */
  async edit(userId: string, messageId: string, content: string): Promise<MessageDto> {
    const own = await this.findOwn(userId, messageId, '고칠');
    if (!content && own._count.attachments === 0) {
      throw new BadRequestException('글을 비울 수 없습니다. 지우려면 메시지를 삭제하세요.');
    }
    const message = toMessageDto(
      await this.prisma.message.update({
        where: { id: messageId },
        data: { content, editedAt: new Date() },
        include: messageInclude,
      }),
    );
    this.realtime.emit(room.channel(message.channelId), SocketEvent.MessageUpdated, message);
    return message;
  }

  /**
   * 메시지 지우기: 내가 보낸 메시지, 또는 커뮤니티 채널이면 소유자·관리자는 남의 메시지도.
   * 첨부는 DB에서 함께 지워지고(연쇄 삭제) 저장소 파일은 여기서 지운다.
   * 이 메시지에 답장한 메시지의 원래 메시지 표시는 비워진다(replyTo = null).
   */
  async remove(userId: string, messageId: string): Promise<void> {
    const { message: own, channel } = await this.findVisible(userId, messageId);
    if (own.authorId !== userId && !(await this.managesChannel(userId, channel.communityId))) {
      throw new ForbiddenException('내가 보낸 메시지만 지울 수 있습니다.');
    }
    const attachments = await this.prisma.attachment.findMany({
      where: { messageId },
      select: { objectKey: true, thumbnailKey: true },
    });
    await this.prisma.message.delete({ where: { id: messageId } });
    await this.attachments.removeObjects(
      attachments.flatMap((a) => [a.objectKey, ...(a.thumbnailKey ? [a.thumbnailKey] : [])]),
    );
    const latest = await this.prisma.message.findFirst({
      where: { channelId: own.channelId },
      orderBy: { id: 'desc' },
      select: { id: true },
    });
    this.realtime.emit(room.channel(own.channelId), SocketEvent.MessageDeleted, {
      channelId: own.channelId,
      messageId,
      lastMessageId: latest?.id ?? null,
    });
  }

  /** 볼 수 있는 채널의 내가 보낸 메시지. 볼 수 없으면 404, 남의 메시지면 403 */
  private async findOwn(userId: string, messageId: string, action: string) {
    const { message } = await this.findVisible(userId, messageId);
    if (message.authorId !== userId) {
      throw new ForbiddenException(`내가 보낸 메시지만 ${action} 수 있습니다.`);
    }
    return message;
  }

  /** 볼 수 있는 채널의 메시지와 그 채널. 볼 수 없으면 404 */
  private async findVisible(userId: string, messageId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        channelId: true,
        authorId: true,
        _count: { select: { attachments: true } },
      },
    });
    if (!message) throw new NotFoundException('메시지를 찾을 수 없습니다.');
    const channel = await this.access.getChannel(userId, message.channelId);
    return { message, channel };
  }

  /** 커뮤니티 채널이고 내가 그 커뮤니티의 소유자·관리자인지 (DM은 늘 false) */
  private async managesChannel(userId: string, communityId: string | null): Promise<boolean> {
    if (!communityId) return false;
    return isManager((await this.access.getMembership(userId, communityId)).role);
  }

  /** 최신 메시지부터 limit개. before를 주면 그보다 오래된 것 */
  async history(
    userId: string,
    channelId: string,
    before: string | undefined,
    limit: number,
  ): Promise<MessagePage> {
    await this.access.getChannel(userId, channelId);
    const rows = await this.prisma.message.findMany({
      where: { channelId, ...(before ? { id: { lt: before } } : {}) },
      orderBy: { id: 'desc' },
      take: limit + 1,
      include: messageInclude,
    });
    return {
      messages: rows.slice(0, limit).map(toMessageDto),
      hasMore: rows.length > limit,
    };
  }

  /** 읽음 위치를 앞으로만 옮긴다 (다른 탭에서 늦게 온 요청이 되돌리지 않도록). */
  async markRead(userId: string, channelId: string, lastReadMessageId: string): Promise<void> {
    await this.access.getChannel(userId, channelId);
    const message = await this.prisma.message.findFirst({
      where: { id: lastReadMessageId, channelId },
      select: { id: true },
    });
    if (!message) throw new BadRequestException('이 채널의 메시지가 아닙니다.');

    const current = await this.prisma.channelReadState.findUnique({
      where: { channelId_userId: { channelId, userId } },
      select: { lastReadMessageId: true },
    });
    if (current && current.lastReadMessageId >= lastReadMessageId) return;
    await this.prisma.channelReadState.upsert({
      where: { channelId_userId: { channelId, userId } },
      create: { channelId, userId, lastReadMessageId },
      update: { lastReadMessageId },
    });
  }
}
