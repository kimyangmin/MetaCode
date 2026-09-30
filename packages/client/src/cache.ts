import type {
  ChannelSummary,
  MessageDeleted,
  CommunitySummary,
  DmSummary,
  MessageDto,
  MessagePage,
} from '@metacode/shared';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';

/**
 * TanStack Query 캐시의 키와, 서버 이벤트(message:created 등)를 캐시에 반영하는 함수.
 * 웹과 네이티브 앱이 같은 키·같은 규칙을 쓴다.
 */

export const queryKeys = {
  communities: ['communities'] as const,
  dms: ['dms'] as const,
  members: (communityId: string) => ['members', communityId] as const,
  messages: (channelId: string) => ['messages', channelId] as const,
};

export type MessagesData = InfiniteData<MessagePage, string | undefined>;

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

/** 한 채널의 메시지 기록 캐시를 메시지마다 바꾼다 (같은 객체를 돌려주면 그대로 둔다) */
function mapMessages(
  queryClient: QueryClient,
  channelId: string,
  update: (message: MessageDto) => MessageDto | null,
): void {
  queryClient.setQueryData<MessagesData>(queryKeys.messages(channelId), (data) => {
    if (!data) return data;
    let changed = false;
    const pages = data.pages.map((page) => {
      let pageChanged = false;
      const messages: MessageDto[] = [];
      for (const message of page.messages) {
        const next = update(message);
        if (next !== message) pageChanged = true;
        if (next) messages.push(next);
      }
      if (!pageChanged) return page;
      changed = true;
      return { ...page, messages };
    });
    return changed ? { ...data, pages } : data;
  });
}

/** 고친 메시지(message:updated): 기록의 그 메시지와, 그 메시지에 답장한 메시지의 원래 메시지 표시를 바꾼다 */
export function updateMessageInCache(queryClient: QueryClient, updated: MessageDto): void {
  mapMessages(queryClient, updated.channelId, (message) => {
    if (message.id === updated.id) return updated;
    if (message.replyTo?.id === updated.id) {
      return { ...message, replyTo: { ...message.replyTo, content: updated.content } };
    }
    return message;
  });
}

/** 지운 메시지(message:deleted): 기록에서 빼고, 답장의 원래 메시지 표시를 비우고, 채널의 최신 메시지를 맞춘다 */
export function removeMessageFromCache(queryClient: QueryClient, deleted: MessageDeleted): void {
  mapMessages(queryClient, deleted.channelId, (message) => {
    if (message.id === deleted.messageId) return null;
    if (message.replyTo?.id === deleted.messageId) return { ...message, replyTo: null };
    return message;
  });
  updateChannelInCaches(queryClient, deleted.channelId, (ch) =>
    ch.lastMessageId === deleted.messageId ? { ...ch, lastMessageId: deleted.lastMessageId } : ch,
  );
}
