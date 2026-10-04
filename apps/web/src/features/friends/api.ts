import type { FriendChanged, FriendsList } from '@metacode/shared';
import { type QueryClient, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiFetch } from '../../api/client';
import { jsonBody } from '../../api/queries';
import { friendsKey, usePresenceStore } from '@metacode/client';

// 친구 상태 판정은 네이티브 앱과 함께 쓴다 (packages/client)
export { friendStatusOf, friendsKey } from '@metacode/client';


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
