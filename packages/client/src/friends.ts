import type { FriendStatus, FriendsList } from '@metacode/shared';

/** 친구 목록 쿼리 키 (friend:updated를 받으면 다시 받는다) */
export const friendsKey = ['friends'] as const;

/** 나와 그 사람의 관계 */
export function friendStatusOf(list: FriendsList | undefined, userId: string): FriendStatus {
  if (!list) return 'none';
  if (list.friends.some((f) => f.user.id === userId)) return 'friends';
  if (list.incoming.some((f) => f.user.id === userId)) return 'incoming';
  if (list.outgoing.some((f) => f.user.id === userId)) return 'outgoing';
  return 'none';
}
