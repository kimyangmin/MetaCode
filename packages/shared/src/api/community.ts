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

/** 사이드바에 그리는 데 필요한 커뮤니티 정보 (내 역할, 채널 목록 포함) */
export interface CommunitySummary {
  id: string;
  name: string;
  myRole: CommunityRole;
  channels: ChannelSummary[];
}

export interface CommunityMember {
  user: UserProfile;
  role: CommunityRole;
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
