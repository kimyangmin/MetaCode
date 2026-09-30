import { queryKeys, updateChannelInCaches, usePresenceStore } from '@metacode/client';
import type {
  CommunityMember,
  CommunitySummary,
  DmSummary,
  MessagePage,
  UserDetail,
} from '@metacode/shared';
import { type QueryClient, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiFetch, apiSend } from './client';

export const meQueryKey = ['me'] as const;

export const fetchMe = () => apiFetch<UserDetail>('/users/me');
export const fetchCommunities = () => apiFetch<CommunitySummary[]>('/communities');
export const fetchDms = () => apiFetch<DmSummary[]>('/dms');
export const fetchMembers = (communityId: string) =>
  apiFetch<CommunityMember[]>(`/communities/${communityId}/members`);
export const fetchMessages = (channelId: string, before?: string) =>
  apiFetch<MessagePage>(
    `/channels/${channelId}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`,
  );

export const useMe = () =>
  useQuery({ queryKey: meQueryKey, queryFn: fetchMe, staleTime: Infinity });

export const useCommunities = () =>
  useQuery({ queryKey: queryKeys.communities, queryFn: fetchCommunities, staleTime: Infinity });

export const useDms = () =>
  useQuery({ queryKey: queryKeys.dms, queryFn: fetchDms, staleTime: Infinity });

/** 커뮤니티 멤버 목록. 받은 온라인 여부를 전역 Presence에도 반영한다 (웹과 같음) */
export function useMembers(communityId: string | undefined) {
  const query = useQuery({
    queryKey: queryKeys.members(communityId ?? ''),
    queryFn: () => fetchMembers(communityId!),
    enabled: !!communityId,
  });
  useEffect(() => {
    if (query.data) {
      usePresenceStore
        .getState()
        .merge(Object.fromEntries(query.data.map((m) => [m.user.id, m.online])));
    }
  }, [query.data]);
  return query;
}

/** 읽음 위치를 서버에 저장하고 캐시에도 반영한다 (웹 markChannelRead와 같음) */
export async function markChannelRead(
  queryClient: QueryClient,
  channelId: string,
  lastReadMessageId: string,
): Promise<void> {
  updateChannelInCaches(queryClient, channelId, (ch) =>
    !ch.lastReadMessageId || lastReadMessageId > ch.lastReadMessageId
      ? { ...ch, lastReadMessageId }
      : ch,
  );
  await apiSend(`/channels/${channelId}/read-state`, 'PUT', { lastReadMessageId });
}
