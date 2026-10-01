import { z } from 'zod';
import { type CharacterChoice, characterChoiceSchema } from '../assets/character.js';
import { PlazaStyle } from '../domain/plaza.js';

/** 프로필에 실리는 캐릭터. 직접 그린 캐릭터면 version(에셋이 바뀐 시각)이 있어서 바뀌면 다시 받는다 */
export type ProfileCharacter = CharacterChoice & { version?: string };

export interface UserProfile {
  id: string;
  /** 사용자 ID: GitHub 로그인 이름. 바꿀 수 없고 DM 상대 찾기 등에 쓴다 */
  username: string;
  /** 다른 사람에게 보이는 닉네임. 정하지 않았으면 null (username을 보여 준다) */
  displayName: string | null;
  /** 프로필 사진: 올린 사진(움직이는 사진이면 첫 장면), 없으면 GitHub 프로필 사진 */
  avatarUrl: string;
  /**
   * 올린 사진이 GIF처럼 움직이면 움직이는 사진 (없으면 null). 채팅 목록 등은 avatarUrl(멈춘 사진)을,
   * 멤버 목록과 정보 팝업은 이것을 쓴다. 옛 서버·캐시에는 없을 수 있다.
   */
  avatarAnimatedUrl?: string | null;
  /** 광장 캐릭터. 고르지 않았으면 null (사용자 ID로 고른 기본 캐릭터, defaultCharacter) */
  character: ProfileCharacter | null;
  /**
   * 횡스크롤 광장에서 쓸 캐릭터. null이면 탑다운과 같은 캐릭터(character)를 쓴다.
   * 옛 서버·캐시에는 없을 수 있다.
   */
  sideCharacter?: ProfileCharacter | null;
}

/**
 * 이 광장 방식에서 보일 캐릭터 (고르지 않았으면 null = 사용자 ID로 고른 기본 캐릭터).
 * 횡스크롤은 따로 고른 것이 있으면 그것, 없으면 탑다운과 같은 캐릭터다.
 */
export function characterFor(
  user: Pick<UserProfile, 'character' | 'sideCharacter'>,
  style: PlazaStyle,
): ProfileCharacter | null {
  return style === PlazaStyle.SideScroll ? (user.sideCharacter ?? user.character) : user.character;
}

/** 프로필 자세히 (정보 팝업, 내 설정) */
export interface UserDetail extends UserProfile {
  /** 자기소개. 없으면 null */
  bio: string | null;
  /** 직접 올린 프로필 사진인지 (false면 GitHub 사진) */
  customAvatar: boolean;
}

export const NICKNAME_MAX_LENGTH = 32;
export const BIO_MAX_LENGTH = 190;
/** 프로필 사진으로 올릴 수 있는 원본 크기 */
export const AVATAR_MAX_BYTES = 8 * 1024 * 1024;
/** 저장하는 프로필 사진 크기 (정사각형, WebP) */
export const AVATAR_SIZE_PX = 256;

/** 비워서 보내면 기본값(닉네임은 사용자 ID, 자기소개는 없음)으로 돌아간다 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => (value === '' ? null : value));

export const updateProfileSchema = z.object({
  nickname: optionalText(NICKNAME_MAX_LENGTH),
  bio: optionalText(BIO_MAX_LENGTH),
});
export type UpdateProfileRequest = z.input<typeof updateProfileSchema>;

export const avatarUploadSchema = z.object({
  size: z.number().int().positive().max(AVATAR_MAX_BYTES),
});
export type AvatarUploadRequest = z.infer<typeof avatarUploadSchema>;

/** 프로필 사진 올리기: 이 주소로 PUT한 뒤 PUT /users/me/avatar로 적용한다 */
export interface AvatarUploadTicket {
  uploadUrl: string;
  headers: Record<string, string>;
  expiresAt: string;
}

/**
 * 올린 사진에서 쓸 곳 (위치 조정). 원본을 보이는 방향(EXIF 회전 반영) 그대로 놓고 잰 0~1 비율:
 * 왼쪽 위(x, y)와 크기(width, height). 주지 않으면 가운데를 채워 자른다.
 * 프로필 사진, 커뮤니티 아이콘·배너가 함께 쓴다.
 */
export const imageCropSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().gt(0).max(1),
    height: z.number().gt(0).max(1),
  })
  // 소수 계산 오차는 조금 봐준다 (서버가 사진 안으로 다시 맞춘다).
  .refine((c) => c.x + c.width <= 1.001 && c.y + c.height <= 1.001, {
    message: '자를 곳이 사진 밖에 있습니다.',
  });
export type ImageCrop = z.infer<typeof imageCropSchema>;

/** 올린 사진 적용하기 (PUT /users/me/avatar, PUT /communities/:id/images/:kind). 본문은 없어도 된다 */
export const applyImageSchema = z.object({ crop: imageCropSchema.optional() }).nullish();
export type ApplyImageRequest = z.infer<typeof applyImageSchema>;

/** 캐릭터 고르기. null이면 기본 캐릭터로 돌아간다 */
/**
 * 캐릭터 고르기. style이 횡스크롤이면 횡스크롤 광장의 캐릭터를 정한다 (null이면 탑다운과 같게).
 * 없으면 탑다운(기본) 캐릭터다 (null이면 사용자 ID로 고른 기본 캐릭터).
 */
export const setCharacterSchema = z.object({
  character: characterChoiceSchema.nullable(),
  style: z.enum([PlazaStyle.TopDown, PlazaStyle.SideScroll]).default(PlazaStyle.TopDown),
});
export type SetCharacterRequest = z.infer<typeof setCharacterSchema>;
