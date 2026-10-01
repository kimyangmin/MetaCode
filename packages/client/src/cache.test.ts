import type { CommunitySummary, MessageDto } from '@metacode/shared';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import {
  type MessagesData,
  addMessageToCache,
  queryKeys,
  removeMessageFromCache,
  updateMessageInCache,
} from './cache.js';

const author = { id: 'u', username: 'u', displayName: null, avatarUrl: '', character: null };
const message = (
  id: string,
  content: string,
  replyTo: MessageDto['replyTo'] = null,
): MessageDto => ({
  id,
  channelId: 'c',
  author,
  content,
  attachments: [],
  replyTo,
  forwarded: false,
  createdAt: '2026-09-28T00:00:00.000Z',
  editedAt: null,
});

function setup() {
  const queryClient = new QueryClient();
  const reply = message('m3', '답장', { id: 'm1', author, content: '처음', attachmentCount: 0 });
  queryClient.setQueryData<MessagesData>(queryKeys.messages('c'), {
    pages: [
      { messages: [reply, message('m2', '둘')], hasMore: true },
      { messages: [message('m1', '처음')], hasMore: false },
    ],
    pageParams: [undefined, 'm2'],
  });
  queryClient.setQueryData<CommunitySummary[]>(queryKeys.communities, [
    {
      id: 'k',
      name: 'k',
      myRole: 'OWNER',
      roles: [],
      channels: [{ id: 'c', lastMessageId: 'm3', lastReadMessageId: 'm2' }],
    } as unknown as CommunitySummary,
  ]);
  const messages = () =>
    queryClient
      .getQueryData<MessagesData>(queryKeys.messages('c'))!
      .pages.flatMap((p) => p.messages);
  return { queryClient, messages };
}

describe('메시지 캐시', () => {
  it('고친 메시지와, 그 메시지에 답장한 메시지의 원래 글 표시를 바꾼다', () => {
    const { queryClient, messages } = setup();
    updateMessageInCache(queryClient, { ...message('m1', '고친 글'), editedAt: 'now' });
    const [reply, , first] = messages();
    expect(first).toMatchObject({ content: '고친 글', editedAt: 'now' });
    expect(reply!.replyTo?.content).toBe('고친 글');
  });

  it('지운 메시지를 빼고, 답장의 원래 메시지를 비우고, 채널의 최신 메시지를 맞춘다', () => {
    const { queryClient, messages } = setup();
    removeMessageFromCache(queryClient, { channelId: 'c', messageId: 'm1', lastMessageId: 'm3' });
    expect(messages().map((m) => m.id)).toEqual(['m3', 'm2']);
    expect(messages()[0]!.replyTo).toBeNull();

    removeMessageFromCache(queryClient, { channelId: 'c', messageId: 'm3', lastMessageId: 'm2' });
    const community = queryClient.getQueryData<CommunitySummary[]>(queryKeys.communities)![0]!;
    expect(community.channels[0]!.lastMessageId).toBe('m2');
  });

  it('내가 보낸 새 메시지는 채널을 읽은 것으로 두고, 남의 메시지는 안 읽음으로 둔다', () => {
    const { queryClient } = setup();
    const channel = () =>
      queryClient.getQueryData<CommunitySummary[]>(queryKeys.communities)![0]!.channels[0]!;
    addMessageToCache(queryClient, message('m4', '남의 메시지'), 'me');
    expect(channel()).toMatchObject({ lastMessageId: 'm4', lastReadMessageId: 'm2' });
    addMessageToCache(
      queryClient,
      { ...message('m5', '내 메시지'), author: { ...author, id: 'me' } },
      'me',
    );
    expect(channel()).toMatchObject({ lastMessageId: 'm5', lastReadMessageId: 'm5' });
  });
});
