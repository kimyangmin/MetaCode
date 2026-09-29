import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AVATAR_MAX_BYTES,
  type AvatarUploadTicket,
  COMMUNITY_IMAGE_SIZE,
  type CommunityImageKind,
} from '@metacode/shared';
import { type CropRatio, SNIFF_BYTES, makeCover, sniffRasterFormat } from '../attachments/image.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { AccessService } from './access.service.js';
import { RolesService } from './roles.service.js';

const UPLOAD_TTL_SECONDS = 10 * 60;

/** 올린 원본을 잠깐 두는 곳 (커뮤니티·종류마다 하나, 적용하면 지운다) */
const uploadKey = (communityId: string, kind: CommunityImageKind) =>
  `community-uploads/${communityId}/${kind}`;
/** 적용한 이미지. 바꿀 때마다 새 이름이라 주소를 오래 캐시해도 된다 */
const newImageKey = (communityId: string, kind: CommunityImageKind) =>
  `community-images/${communityId}/${kind}-${randomUUID()}.webp`;

const column = { icon: 'iconKey', banner: 'bannerKey' } as const;

/**
 * 커뮤니티 설정의 일반 항목: 이름, 아이콘, 배너 (소유자·관리자).
 * 바뀌면 community:updated로 알려 멤버들이 커뮤니티 정보를 다시 받는다.
 */
@Injectable()
export class CommunityProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly access: AccessService,
    private readonly roles: RolesService,
  ) {}

  async rename(userId: string, communityId: string, name: string): Promise<void> {
    await this.access.requireManager(userId, communityId, '커뮤니티 설정');
    await this.prisma.community.update({ where: { id: communityId }, data: { name } });
    this.roles.notify(communityId);
  }

  /** 이미지 올리기 1단계: 원본을 올릴 주소 (크기가 서명에 들어간다) */
  async createUpload(
    userId: string,
    communityId: string,
    kind: CommunityImageKind,
    size: number,
  ): Promise<AvatarUploadTicket> {
    await this.access.requireManager(userId, communityId, '커뮤니티 설정');
    const expiresAt = new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000);
    return {
      uploadUrl: await this.storage.presignPut(
        uploadKey(communityId, kind),
        size,
        UPLOAD_TTL_SECONDS,
      ),
      headers: { 'Content-Type': 'application/octet-stream' },
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * 이미지 올리기 2단계: 파일 앞부분으로 이미지인지 확인하고, 종류별 크기로 자른 WebP로 적용한다.
   * crop이 있으면 사용자가 고른 곳을, 없으면 가운데를 채워 자른다. 원본과 이전 이미지는 지운다.
   */
  async apply(
    userId: string,
    communityId: string,
    kind: CommunityImageKind,
    crop?: CropRatio,
  ): Promise<void> {
    await this.access.requireManager(userId, communityId, '커뮤니티 설정');
    const source = uploadKey(communityId, kind);
    const size = await this.storage.size(source);
    if (size === null) throw new BadRequestException('올린 이미지가 없습니다. 다시 올려 주세요.');
    try {
      if (size > AVATAR_MAX_BYTES) throw new BadRequestException('이미지가 너무 큽니다.');
      if (!sniffRasterFormat(await this.storage.readHead(source, SNIFF_BYTES))) {
        throw new BadRequestException('JPEG, PNG, GIF, WebP, AVIF 이미지만 쓸 수 있습니다.');
      }
      const { width, height } = COMMUNITY_IMAGE_SIZE[kind];
      const image = await makeCover(await this.storage.read(source), width, height, crop);
      if (!image) throw new BadRequestException('이미지를 읽지 못했습니다.');
      const key = newImageKey(communityId, kind);
      await this.storage.write(key, image, 'image/webp');
      const previous = await this.prisma.community.findUniqueOrThrow({
        where: { id: communityId },
      });
      await this.prisma.community.update({
        where: { id: communityId },
        data: { [column[kind]]: key },
      });
      const old = previous[column[kind]];
      if (old) await this.storage.remove([old]);
      this.roles.notify(communityId);
    } finally {
      await this.storage.remove([source]);
    }
  }

  async remove(userId: string, communityId: string, kind: CommunityImageKind): Promise<void> {
    await this.access.requireManager(userId, communityId, '커뮤니티 설정');
    const previous = await this.prisma.community.findUniqueOrThrow({
      where: { id: communityId },
    });
    const old = previous[column[kind]];
    if (!old) return;
    await this.prisma.community.update({
      where: { id: communityId },
      data: { [column[kind]]: null },
    });
    await this.storage.remove([old]);
    this.roles.notify(communityId);
  }

  /** 이미지 파일 (없으면 null). 누구나 받을 수 있다: 주소에 무작위 ID가 들어가 추측할 수 없다 */
  async read(communityId: string, file: string): Promise<Buffer | null> {
    try {
      return await this.storage.read(`community-images/${communityId}/${file}`);
    } catch {
      return null;
    }
  }
}
