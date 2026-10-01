import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AVATAR_MAX_BYTES,
  AVATAR_SIZE_PX,
  type AssetManifest,
  type AvatarUploadTicket,
  BUILTIN_CHARACTERS,
  type CharacterChoice,
  PlazaStyle,
  type ProfileCharacter,
  SocketEvent,
  type UserDetail,
  type UserProfile,
  characterFitsStyle,
} from '@metacode/shared';
import {
  type CropRatio,
  SNIFF_BYTES,
  makeAvatar,
  sniffRasterFormat,
} from '../attachments/image.js';
import type { Env } from '../config/env.js';
import { Prisma, type User } from '../generated/prisma/client.js';
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
/** 멈춘 사진과 움직이는 사진(원본이 움직일 때만)의 키. 같은 무작위 ID를 쓴다 */
const newAvatarKeys = (userId: string) => {
  const id = randomUUID();
  return {
    still: `avatars/${userId}/${id}.webp`,
    animated: `avatars/${userId}/${id}-animated.webp`,
  };
};

/** 프로필 사진 주소의 앞부분 (PUBLIC_SERVER_URL). 서비스가 만들어질 때 설정한다 */
let publicServerUrl = 'http://localhost:3000';

@Injectable()
export class UsersService {
  /** 프로필(닉네임, 사진, 캐릭터)이 바뀌면 부를 곳. 프로필을 따로 들고 있는 서비스(통화 상태)가 등록한다 */
  private readonly profileListeners: ((profile: UserProfile) => void)[] = [];

  onProfileChanged(listener: (profile: UserProfile) => void): void {
    this.profileListeners.push(listener);
  }

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
   * crop이 있으면 사용자가 고른 곳을, 없으면 가운데를 자른다. GIF처럼 움직이는 사진이면 움직이는 WebP도
   * 따로 만든다 (멈춘 사진은 채팅 목록 등에, 움직이는 사진은 멤버 목록·정보 팝업에). 원본과 이전 사진은 지운다.
   */
  async applyAvatar(userId: string, crop?: CropRatio): Promise<UserDetail> {
    const uploadKey = avatarUploadKey(userId);
    const size = await this.storage.size(uploadKey);
    if (size === null) throw new BadRequestException('올린 사진이 없습니다. 다시 올려 주세요.');
    try {
      if (size > AVATAR_MAX_BYTES) throw new BadRequestException('사진이 너무 큽니다.');
      if (!sniffRasterFormat(await this.storage.readHead(uploadKey, SNIFF_BYTES))) {
        throw new BadRequestException('JPEG, PNG, GIF, WebP, AVIF 이미지만 쓸 수 있습니다.');
      }
      const avatar = await makeAvatar(await this.storage.read(uploadKey), AVATAR_SIZE_PX, crop);
      if (!avatar) throw new BadRequestException('이미지를 읽지 못했습니다.');

      const previous = await this.find(userId);
      const keys = newAvatarKeys(userId);
      await this.storage.write(keys.still, avatar.still, 'image/webp');
      if (avatar.animated) await this.storage.write(keys.animated, avatar.animated, 'image/webp');
      const user = await this.prisma.user.update({
        where: { id: userId },
        data: { avatarKey: keys.still, avatarAnimatedKey: avatar.animated ? keys.animated : null },
      });
      await this.storage.remove(avatarKeysOf(previous));
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
      data: { avatarKey: null, avatarAnimatedKey: null },
    });
    await this.storage.remove(avatarKeysOf(previous));
    await this.announce(user);
    return toDetail(user);
  }

  /**
   * 광장 캐릭터 고르기. 기본 캐릭터나 직접 그린 캐릭터만 고를 수 있다 (남의 캐릭터는 안 됨).
   * 탑다운(style 기본)은 null이면 사용자 ID로 고른 기본 캐릭터로, 횡스크롤은 null이면 탑다운과 같은
   * 캐릭터로 돌아간다.
   */
  async setCharacter(
    userId: string,
    choice: CharacterChoice | null,
    style: PlazaStyle = PlazaStyle.TopDown,
  ): Promise<UserDetail> {
    let character: ProfileCharacter | null = null;
    if (choice) {
      if (choice.asset.startsWith('builtin:')) {
        if (!BUILTIN_CHARACTERS.includes(choice.asset)) {
          throw new BadRequestException('기본 캐릭터가 아닙니다.');
        }
        character = { asset: choice.asset, colors: choice.colors };
      } else {
        const asset = await this.prisma.asset.findUnique({ where: { id: choice.asset } });
        if (!asset || asset.kind !== 'CHARACTER' || asset.creatorId !== userId) {
          throw new BadRequestException('직접 만든 캐릭터만 고를 수 있습니다.');
        }
        // 횡스크롤용 캐릭터는 위·아래 모습이 없어서 탑다운 광장에서 쓸 수 없다.
        if (!characterFitsStyle(asset.manifest as unknown as AssetManifest, style)) {
          throw new BadRequestException('횡스크롤용 캐릭터는 탑다운 광장에서 쓸 수 없습니다.');
        }
        character = {
          asset: asset.id,
          colors: choice.colors,
          version: asset.updatedAt.toISOString(),
        };
      }
    }
    const column = style === PlazaStyle.SideScroll ? 'sideCharacter' : 'character';
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { [column]: character ?? Prisma.DbNull },
    });
    await this.announce(user);
    return toDetail(user);
  }

  /**
   * 직접 그린 캐릭터를 고치거나 지웠다: 그 캐릭터를 쓰는 사람(만든 사람뿐)의 프로필을 고치고 알린다.
   * 고쳤으면 version을 올려 다른 사람들이 새 그림을 받게 하고, 지웠으면 기본 캐릭터로 돌린다.
   */
  async characterAssetChanged(
    creatorId: string,
    assetId: string,
    updatedAt: Date | null,
  ): Promise<void> {
    const user = await this.find(creatorId);
    // 탑다운·횡스크롤 캐릭터 중 이 에셋을 쓰는 쪽을 고친다 (둘 다일 수 있다).
    const data: Prisma.UserUpdateInput = {};
    for (const column of ['character', 'sideCharacter'] as const) {
      const current = user[column] as ProfileCharacter | null;
      if (current?.asset !== assetId) continue;
      data[column] = updatedAt ? { ...current, version: updatedAt.toISOString() } : Prisma.DbNull;
    }
    if (Object.keys(data).length === 0) return;
    const updated = await this.prisma.user.update({ where: { id: creatorId }, data });
    await this.announce(updated);
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

  /** 닉네임, 사진, 캐릭터가 바뀌었다: 같은 커뮤니티·DM 사람, 친구(요청 포함)와 본인(다른 탭·기기)에게 알린다 */
  private async announce(user: User): Promise<void> {
    const profile = toProfile(user);
    for (const listener of this.profileListeners) listener(profile);
    const [communities, channels, friends] = await Promise.all([
      this.prisma.communityMember.findMany({
        where: { userId: user.id },
        select: { communityId: true },
      }),
      this.prisma.channelMember.findMany({
        where: { userId: user.id },
        select: { channelId: true },
      }),
      // 친구 목록에도 이름·사진이 보이므로 요청 중인 사람까지 알린다.
      this.prisma.friendship.findMany({
        where: { OR: [{ requesterId: user.id }, { addresseeId: user.id }] },
        select: { requesterId: true, addresseeId: true },
      }),
    ]);
    this.realtime.emit(
      [
        `user:${user.id}`,
        ...communities.map((m) => `community:${m.communityId}`),
        ...channels.map((m) => `channel:${m.channelId}`),
        ...friends.map((f) => `user:${f.requesterId === user.id ? f.addresseeId : f.requesterId}`),
      ],
      SocketEvent.UserUpdated,
      profile,
    );
  }
}

type ProfileSource = Pick<
  User,
  | 'id'
  | 'username'
  | 'nickname'
  | 'avatarUrl'
  | 'avatarKey'
  | 'avatarAnimatedKey'
  | 'character'
  | 'sideCharacter'
>;

/** 올린 프로필 사진 파일들 (멈춘 사진, 움직이는 사진) */
function avatarKeysOf(user: Pick<User, 'avatarKey' | 'avatarAnimatedKey'>): string[] {
  return [user.avatarKey, user.avatarAnimatedKey].filter((key): key is string => !!key);
}

/** 인증 없이 주는 저장소 파일(프로필 사진, 커뮤니티 이미지)의 주소 */
export function publicFileUrl(key: string): string {
  return `${publicServerUrl}/${key}`;
}

export function toProfile(user: ProfileSource): UserProfile {
  return {
    id: user.id,
    username: user.username,
    displayName: user.nickname,
    avatarUrl: user.avatarKey ? publicFileUrl(user.avatarKey) : user.avatarUrl,
    avatarAnimatedUrl:
      user.avatarKey && user.avatarAnimatedKey ? publicFileUrl(user.avatarAnimatedKey) : null,
    character: (user.character as ProfileCharacter | null) ?? null,
    sideCharacter: (user.sideCharacter as ProfileCharacter | null) ?? null,
  };
}

export function toDetail(user: ProfileSource & Pick<User, 'bio'>): UserDetail {
  return { ...toProfile(user), bio: user.bio, customAvatar: user.avatarKey !== null };
}
