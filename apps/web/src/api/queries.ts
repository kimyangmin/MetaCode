import type { CommunityMember, CommunitySummary, DmSummary, MessagePage } from '@metacode/shared';
import { updateChannelInCaches } from '@metacode/client';
import type { QueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

// 캐시 키와 캐시 고치기는 웹과 네이티브 앱이 함께 쓴다 (packages/client)
export {
  type MessagesData,
  addMessageToCache,
  queryKeys,
  removeMessageFromCache,
  updateChannelInCaches,
  updateMessageInCache,
} from '@metacode/client';

export const fetchCommunities = () => apiFetch<CommunitySummary[]>('/communities');
export const fetchDms = () => apiFetch<DmSummary[]>('/dms');
export const fetchMembers = (communityId: string) =>
  apiFetch<CommunityMember[]>(`/communities/${communityId}/members`);
export const fetchMessages = (channelId: string, before?: string) =>
  apiFetch<MessagePage>(
    `/channels/${channelId}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`,
  );

export const jsonBody = (body: unknown): RequestInit => ({
  body: JSON.stringify(body),
  headers: { 'Content-Type': 'application/json' },
});

/** 읽음 위치를 서버에 저장하고 캐시에도 반영한다. */
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
  await apiFetch(`/channels/${channelId}/read-state`, {
    method: 'PUT',
    ...jsonBody({ lastReadMessageId }),
  });
}
