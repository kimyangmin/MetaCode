import { z } from 'zod';

export interface UserProfile {
  id: string;
  /** 사용자 ID: GitHub 로그인 이름. 바꿀 수 없고 DM 상대 찾기 등에 쓴다 */
  username: string;
  /** 다른 사람에게 보이는 닉네임. 정하지 않았으면 null (username을 보여 준다) */
  displayName: string | null;
  /** 프로필 사진: 올린 사진, 없으면 GitHub 프로필 사진 */
  avatarUrl: string;
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
