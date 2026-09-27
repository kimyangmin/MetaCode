import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AVATAR_MAX_BYTES,
  AVATAR_SIZE_PX,
  type AvatarUploadTicket,
  SocketEvent,
  type UserDetail,
  type UserProfile,
} from '@metacode/shared';
import { SNIFF_BYTES, makeAvatar, sniffRasterFormat } from '../attachments/image.js';
import type { Env } from '../config/env.js';
import type { User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { StorageService } from '../storage/storage.service.js';

export interface GithubProfile {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string;
}

/** 프로필 사진을 올리는 presigned URL 유효 시간 (초) */
const AVATAR_UPLOAD_TTL_SECONDS = 10 * 60;

/** 올린 원본을 잠깐 두는 곳 (사용자마다 하나, 적용하면 지운다) */
const avatarUploadKey = (userId: string) => `avatar-uploads/${userId}`;
/** 적용한 프로필 사진. 바꿀 때마다 새 이름이라 주소를 오래 캐시해도 된다 */
const newAvatarKey = (userId: string) => `avatars/${userId}/${randomUUID()}.webp`;

/** 프로필 사진 주소의 앞부분 (PUBLIC_SERVER_URL). 서비스가 만들어질 때 설정한다 */
let publicServerUrl = 'http://localhost:3000';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly realtime: RealtimeService,
    config: ConfigService<Env, true>,
  ) {
    publicServerUrl = config.get('PUBLIC_SERVER_URL').replace(/\/$/, '');
  }

  /**
   * GitHub 로그인마다 사용자 ID, GitHub 이름, GitHub 사진을 GitHub 계정 기준으로 맞춘다.
   * 닉네임, 자기소개, 직접 올린 사진은 건드리지 않는다.
   */
  async upsertFromGithub(github: GithubProfile): Promise<UserProfile> {
    const profile = {
      username: github.login,
      displayName: github.name,
      avatarUrl: github.avatarUrl,
    };
    const user = await this.prisma.user.upsert({
      where: { githubId: BigInt(github.id) },
      create: { githubId: BigInt(github.id), ...profile },
      update: profile,
    });
    return toProfile(user);
  }

  /** DM 상대 찾기: 사용자 ID(GitHub 아이디) 앞부분으로 검색한다 (나는 제외, 최대 10명). */
  async search(userId: string, query: string): Promise<UserProfile[]> {
    const users = await this.prisma.user.findMany({
      where: { id: { not: userId }, username: { startsWith: query, mode: 'insensitive' } },
      orderBy: { username: 'asc' },
      take: 10,
    });
    return users.map(toProfile);
  }

  async getProfile(userId: string): Promise<UserDetail> {
    return toDetail(await this.find(userId));
  }

  /** 닉네임, 자기소개 바꾸기. 보내지 않은 항목은 그대로 두고, null(빈 값)이면 기본값으로 돌아간다 */
  async updateProfile(
    userId: string,
    changes: { nickname?: string | null; bio?: string | null },
  ): Promise<UserDetail> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(changes.nickname !== undefined && { nickname: changes.nickname }),
        ...(changes.bio !== undefined && { bio: changes.bio }),
      },
    });
    if (changes.nickname !== undefined) await this.announce(user);
    return toDetail(user);
  }

  /** 프로필 사진 올리기 1단계: 원본을 올릴 주소 (크기가 서명에 들어간다) */
  async createAvatarUpload(userId: string, size: number): Promise<AvatarUploadTicket> {
    const expiresAt = new Date(Date.now() + AVATAR_UPLOAD_TTL_SECONDS * 1000);
    return {
      uploadUrl: await this.storage.presignPut(
        avatarUploadKey(userId),
        size,
        AVATAR_UPLOAD_TTL_SECONDS,
      ),
      headers: { 'Content-Type': 'application/octet-stream' },
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * 프로필 사진 올리기 2단계: 올린 원본이 이미지인지 파일 앞부분으로 확인하고, 정사각형 WebP로 만들어 적용한다.
   * 원본과 이전 사진은 지운다.
   */
  async applyAvatar(userId: string): Promise<UserDetail> {
    const uploadKey = avatarUploadKey(userId);
    const size = await this.storage.size(uploadKey);
    if (size === null) throw new BadRequestException('올린 사진이 없습니다. 다시 올려 주세요.');
    try {
      if (size > AVATAR_MAX_BYTES) throw new BadRequestException('사진이 너무 큽니다.');
      if (!sniffRasterFormat(await this.storage.readHead(uploadKey, SNIFF_BYTES))) {
        throw new BadRequestException('JPEG, PNG, GIF, WebP, AVIF 이미지만 쓸 수 있습니다.');
      }
      const avatar = await makeAvatar(await this.storage.read(uploadKey), AVATAR_SIZE_PX);
      if (!avatar) throw new BadRequestException('이미지를 읽지 못했습니다.');

      const previous = await this.find(userId);
      const avatarKey = newAvatarKey(userId);
      await this.storage.write(avatarKey, avatar, 'image/webp');
      const user = await this.prisma.user.update({ where: { id: userId }, data: { avatarKey } });
      if (previous.avatarKey) await this.storage.remove([previous.avatarKey]);
      await this.announce(user);
      return toDetail(user);
    } finally {
      await this.storage.remove([uploadKey]);
    }
  }

  /** 올린 프로필 사진을 지우고 GitHub 사진으로 돌아간다 */
  async removeAvatar(userId: string): Promise<UserDetail> {
    const previous = await this.find(userId);
    if (!previous.avatarKey) return toDetail(previous);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarKey: null },
    });
    await this.storage.remove([previous.avatarKey]);
    await this.announce(user);
    return toDetail(user);
  }

  /** 프로필 사진 파일 (없으면 null). 누구나 받을 수 있다: 주소에 무작위 ID가 들어가 추측할 수 없다 */
  async readAvatar(userId: string, file: string): Promise<Buffer | null> {
    try {
      return await this.storage.read(`avatars/${userId}/${file}`);
    } catch {
      return null;
    }
  }

  private async find(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('사용자를 찾을 수 없습니다.');
    return user;
  }

  /** 닉네임이나 사진이 바뀌었다: 같은 커뮤니티·DM 사람과 본인(다른 탭·기기)에게 알린다 */
  private async announce(user: User): Promise<void> {
    const [communities, channels] = await Promise.all([
      this.prisma.communityMember.findMany({
        where: { userId: user.id },
        select: { communityId: true },
      }),
      this.prisma.channelMember.findMany({
        where: { userId: user.id },
        select: { channelId: true },
      }),
    ]);
    this.realtime.emit(
      [
        `user:${user.id}`,
        ...communities.map((m) => `community:${m.communityId}`),
        ...channels.map((m) => `channel:${m.channelId}`),
      ],
      SocketEvent.UserUpdated,
      toProfile(user),
    );
  }
}

type ProfileSource = Pick<User, 'id' | 'username' | 'nickname' | 'avatarUrl' | 'avatarKey'>;

export function toProfile(user: ProfileSource): UserProfile {
  return {
    id: user.id,
    username: user.username,
    displayName: user.nickname,
    avatarUrl: user.avatarKey ? `${publicServerUrl}/${user.avatarKey}` : user.avatarUrl,
  };
}

export function toDetail(user: ProfileSource & Pick<User, 'bio'>): UserDetail {
  return { ...toProfile(user), bio: user.bio, customAvatar: user.avatarKey !== null };
}
