import type { CommunitySummary, DmSummary, UserDetail } from '@metacode/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { apiFetch } from '../../api/client';
import { fetchCommunities, fetchDms, fetchMembers, jsonBody, queryKeys } from '../../api/queries';
import { usePresenceStore } from '../../stores/presence';
import { meQueryKey } from '../auth/auth';

export const useCommunities = () =>
  useQuery({ queryKey: queryKeys.communities, queryFn: fetchCommunities, staleTime: Infinity });

export const useDms = () =>
  useQuery({ queryKey: queryKeys.dms, queryFn: fetchDms, staleTime: Infinity });

/** 커뮤니티 멤버 목록. 받은 온라인 여부를 전역 Presence에도 반영한다. */
export function useMembers(communityId: string) {
  const query = useQuery({
    queryKey: queryKeys.members(communityId),
    queryFn: () => fetchMembers(communityId),
    enabled: communityId !== '',
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

/** 로그인한 사용자. 로그인 후 화면에서만 쓴다 (App이 로그인 전에는 이 화면을 그리지 않는다). */
export function useMeRequired(): UserDetail {
  const queryClient = useQueryClient();
  const me = queryClient.getQueryData<UserDetail | null>(meQueryKey);
  if (!me) throw new Error('로그인이 필요합니다.');
  return me;
}

/** 이 사람들과의 DM을 열고(없으면 만들고) 그 대화로 이동한다. */
export function useOpenDm() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return async (userIds: string[]) => {
    const dm = await apiFetch<DmSummary>('/dms', { method: 'POST', ...jsonBody({ userIds }) });
    queryClient.setQueryData<DmSummary[]>(queryKeys.dms, (dms) =>
      dms && !dms.some((d) => d.id === dm.id) ? [dm, ...dms] : dms,
    );
    navigate(`/dm/${dm.id}`);
  };
}

export function upsertCommunity(
  list: CommunitySummary[] | undefined,
  community: CommunitySummary,
): CommunitySummary[] {
  if (!list) return [community];
  return list.some((c) => c.id === community.id)
    ? list.map((c) => (c.id === community.id ? community : c))
    : [...list, community];
}
