import type {
  ChannelSummary,
  CommunityMember,
  CommunitySummary,
  DmSummary,
  MessageDto,
  MessagePage,
} from '@metacode/shared';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

export const queryKeys = {
  communities: ['communities'] as const,
  dms: ['dms'] as const,
  members: (communityId: string) => ['members', communityId] as const,
  messages: (channelId: string) => ['messages', channelId] as const,
};

export type MessagesData = InfiniteData<MessagePage, string | undefined>;

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

/** 채널 목록(커뮤니티, DM) 캐시에서 한 채널의 정보를 바꾼다. */
export function updateChannelInCaches(
  queryClient: QueryClient,
  channelId: string,
  update: (channel: ChannelSummary) => ChannelSummary,
): void {
  queryClient.setQueryData<CommunitySummary[]>(queryKeys.communities, (communities) =>
    communities?.map((c) =>
      c.channels.some((ch) => ch.id === channelId)
        ? { ...c, channels: c.channels.map((ch) => (ch.id === channelId ? update(ch) : ch)) }
        : c,
    ),
  );
  queryClient.setQueryData<DmSummary[]>(queryKeys.dms, (dms) =>
    dms?.map((dm) => (dm.id === channelId ? { ...dm, ...update(dm) } : dm)),
  );
}

/** 새 메시지를 기록 캐시 맨 앞(최신)에 넣는다. 이미 있으면(내가 보낸 것의 중복 수신) 그대로 둔다. */
export function addMessageToCache(queryClient: QueryClient, message: MessageDto): void {
  queryClient.setQueryData<MessagesData>(queryKeys.messages(message.channelId), (data) => {
    if (!data) return data;
    if (data.pages.some((p) => p.messages.some((m) => m.id === message.id))) return data;
    const [first, ...rest] = data.pages;
    return {
      ...data,
      pages: [{ ...first!, messages: [message, ...first!.messages] }, ...rest],
    };
  });
  updateChannelInCaches(queryClient, message.channelId, (ch) =>
    !ch.lastMessageId || message.id > ch.lastMessageId ? { ...ch, lastMessageId: message.id } : ch,
  );
}

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
