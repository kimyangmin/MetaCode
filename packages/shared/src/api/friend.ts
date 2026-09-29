import { z } from 'zod';
import type { UserProfile } from './user.js';

/**
 * 친구. 사용자 ID(GitHub 아이디)로 요청을 보내고 상대가 받으면 서로 친구가 된다.
 * 서로 동시에 요청하면(상대의 요청이 이미 와 있으면) 바로 친구가 된다.
 */
export const sendFriendRequestSchema = z.object({
  username: z.string().trim().min(1, '사용자 ID를 입력해 주세요.').max(39),
});
export type SendFriendRequest = z.infer<typeof sendFriendRequestSchema>;

/** 나와 그 사람의 관계 */
export type FriendStatus = 'none' | 'friends' | 'incoming' | 'outgoing';

export interface FriendDto {
  user: UserProfile;
  online: boolean;
  /** 친구가 된 시각 */
  since: string;
}

export interface FriendRequestDto {
  user: UserProfile;
  online: boolean;
  createdAt: string;
}

export interface FriendsList {
  friends: FriendDto[];
  /** 받은 요청 */
  incoming: FriendRequestDto[];
  /** 보낸 요청 */
  outgoing: FriendRequestDto[];
}

/** 친구 관계가 바뀌었다 (요청·수락·거절·취소·끊기). 두 사람 모두에게 알린다. userId는 상대 */
export interface FriendChanged {
  userId: string;
  status: FriendStatus;
}
