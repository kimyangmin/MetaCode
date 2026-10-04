import { friendsKey, queryKeys, usePresenceStore } from '@metacode/client';
import type { DmSummary, FriendChanged, FriendsList } from '@metacode/shared';
import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { apiFetch, apiSend } from './client';

/** 친구, 받은 요청, 보낸 요청 (웹 features/friends/api.ts와 같음). 온라인 여부는 전역 Presence에도 넣는다 */
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
  const result = await apiSend<FriendChanged>('/friends/requests', 'POST', { username });
  refresh(queryClient);
  return result;
}

export async function acceptFriend(queryClient: QueryClient, userId: string) {
  await apiSend<FriendChanged>(`/friends/requests/${userId}/accept`, 'POST');
  refresh(queryClient);
}

/** 받은 요청 거절, 보낸 요청 취소, 친구 끊기 */
export async function removeFriend(queryClient: QueryClient, userId: string) {
  await apiSend<FriendChanged>(`/friends/${userId}`, 'DELETE');
  refresh(queryClient);
}

/** 그 사람(들)과의 DM을 열거나 만들어 그 화면으로 간다 (웹 useOpenDm) */
export function useOpenDm() {
  const queryClient = useQueryClient();
  return async (userIds: string[]) => {
    const dm = await apiSend<DmSummary>('/dms', 'POST', { userIds });
    queryClient.setQueryData<DmSummary[]>(queryKeys.dms, (dms) =>
      dms && !dms.some((d) => d.id === dm.id) ? [dm, ...dms] : dms,
    );
    router.replace(`/dm/${dm.id}`);
  };
}
