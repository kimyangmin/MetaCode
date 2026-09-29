import type { FriendChanged, FriendStatus, FriendsList } from '@metacode/shared';
import { type QueryClient, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiFetch } from '../../api/client';
import { jsonBody } from '../../api/queries';
import { usePresenceStore } from '../../stores/presence';

export const friendsKey = ['friends'] as const;

/** 친구, 받은 요청, 보낸 요청. 받은 온라인 여부를 전역 Presence에도 반영한다 (friend:updated로 다시 받음) */
export function useFriends() {
  const query = useQuery({
    queryKey: friendsKey,
    queryFn: () => apiFetch<FriendsList>('/friends'),
    staleTime: Infinity,
  });
  useEffect(() => {
    if (!query.data) return;
    const { friends, incoming, outgoing } = query.data;
    usePresenceStore
      .getState()
      .merge(
        Object.fromEntries(
          [...friends, ...incoming, ...outgoing].map((f) => [f.user.id, f.online]),
        ),
      );
  }, [query.data]);
  return query;
}

/** 나와 그 사람의 관계 */
export function friendStatusOf(list: FriendsList | undefined, userId: string): FriendStatus {
  if (!list) return 'none';
  if (list.friends.some((f) => f.user.id === userId)) return 'friends';
  if (list.incoming.some((f) => f.user.id === userId)) return 'incoming';
  if (list.outgoing.some((f) => f.user.id === userId)) return 'outgoing';
  return 'none';
}

const refresh = (queryClient: QueryClient) =>
  void queryClient.invalidateQueries({ queryKey: friendsKey });

export async function sendFriendRequest(queryClient: QueryClient, username: string) {
  const result = await apiFetch<FriendChanged>('/friends/requests', {
    method: 'POST',
    ...jsonBody({ username }),
  });
  refresh(queryClient);
  return result;
}

export async function acceptFriend(queryClient: QueryClient, userId: string) {
  await apiFetch<FriendChanged>(`/friends/requests/${userId}/accept`, { method: 'POST' });
  refresh(queryClient);
}

/** 받은 요청 거절, 보낸 요청 취소, 친구 끊기 */
export async function removeFriend(queryClient: QueryClient, userId: string) {
  await apiFetch<FriendChanged>(`/friends/${userId}`, { method: 'DELETE' });
  refresh(queryClient);
}
