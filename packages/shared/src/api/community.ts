import { z } from 'zod';
import type { ChannelSummary } from './channel.js';
import type { UserProfile } from './user.js';

export const CommunityRole = {
  Owner: 'OWNER',
  Admin: 'ADMIN',
  Member: 'MEMBER',
} as const;

export type CommunityRole = (typeof CommunityRole)[keyof typeof CommunityRole];

export const createCommunitySchema = z.object({
  name: z.string().trim().min(1, '이름을 입력해 주세요.').max(50),
});

export type CreateCommunityRequest = z.infer<typeof createCommunitySchema>;

/** 소유자와 관리자는 역할, 채널, 권한을 관리하고 모든 채널을 본다 */
export const isManager = (role: CommunityRole): boolean => role !== CommunityRole.Member;

/** 사이드바에 그리는 데 필요한 커뮤니티 정보 (내 역할, 볼 수 있는 채널, 커뮤니티의 역할 목록) */
export interface CommunitySummary {
  id: string;
  name: string;
  myRole: CommunityRole;
  channels: ChannelSummary[];
  roles: RoleDto[];
}

/** 커뮤니티가 만든 역할 (Discord식). 비공개 채널을 이 역할을 가진 멤버에게만 보여 줄 수 있다 */
export interface RoleDto {
  id: string;
  name: string;
  /** #rrggbb. 멤버 이름 색 */
  color: string | null;
  position: number;
}

/** 한 커뮤니티에 만들 수 있는 역할 수 */
export const MAX_ROLES = 50;

const roleColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, '색은 #rrggbb 형식이어야 합니다.')
  .transform((c) => c.toLowerCase());

export const createRoleSchema = z.object({
  name: z.string().trim().min(1, '이름을 입력해 주세요.').max(30),
  color: roleColorSchema.nullable().default(null),
});

export type CreateRoleRequest = z.input<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  name: z.string().trim().min(1, '이름을 입력해 주세요.').max(30).optional(),
  color: roleColorSchema.nullable().optional(),
});

export type UpdateRoleRequest = z.input<typeof updateRoleSchema>;

/** 역할 ID 목록 (중복 제거) */
export const roleIdsSchema = z
  .array(z.uuid())
  .max(MAX_ROLES)
  .transform((ids) => [...new Set(ids)]);

/** 멤버의 역할을 이 목록으로 바꾼다 */
export const setMemberRolesSchema = z.object({ roleIds: roleIdsSchema });

/** 순서 바꾸기: 전체 목록을 새 순서대로 보낸다 (역할, 채널). 빠지거나 남는 항목이 있으면 거절한다 */
export const reorderSchema = z.object({
  ids: z
    .array(z.uuid())
    .min(1)
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length, '같은 항목이 두 번 있습니다.'),
});

export type ReorderRequest = z.infer<typeof reorderSchema>;

/** 관리자로 올리거나 내린다 (소유자만) */
export const setAdminSchema = z.object({ admin: z.boolean() });

export interface CommunityMember {
  user: UserProfile;
  role: CommunityRole;
  /** 가진 역할 (RoleDto.id) */
  roleIds: string[];
  online: boolean;
}

export interface InviteInfo {
  code: string;
  communityId: string;
  communityName: string;
  memberCount: number;
  expiresAt: string | null;
  /** 이미 멤버인지 */
  joined: boolean;
}
