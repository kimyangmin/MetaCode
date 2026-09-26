import {
  type MessageDto,
  SocketEvent,
  TYPING_THROTTLE_MS,
  type UserProfile,
  hasUnread,
} from '@metacode/shared';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addMessageToCache, fetchMessages, markChannelRead, queryKeys } from '../../api/queries';
import { useRealtime } from '../../realtime/RealtimeProvider';
import { useTypingUsers } from '../../stores/typing';
import { displayName } from '../../ui/format';
import { Composer } from './Composer';
import { MessageList, type PendingMessage } from './MessageList';

const SEND_TIMEOUT_MS = 10_000;

interface ChatViewProps {
  channelId: string;
  title: string;
  /** 제목 앞 기호 (# 또는 @) */
  prefix: string;
  me: UserProfile;
  lastReadMessageId: string | null;
  /** 입력 중인 사람 이름을 찾을 때 쓴다 */
  people: UserProfile[];
}

/** 채팅 모드: 한 채널의 대화 기록, 입력 중 표시, 입력창 */
export function ChatView({
  channelId,
  title,
  prefix,
  me,
  lastReadMessageId,
  people,
}: ChatViewProps) {
  const queryClient = useQueryClient();
  const { socket } = useRealtime();
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const lastTypingSent = useRef(0);

  const history = useInfiniteQuery({
    queryKey: queryKeys.messages(channelId),
    queryFn: ({ pageParam }) => fetchMessages(channelId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasMore ? last.messages.at(-1)?.id : undefined),
    // 실시간 이벤트로 최신 상태를 유지하고, 재연결하면 다시 불러온다.
    staleTime: Infinity,
  });
  const messages = useMemo(
    () => history.data?.pages.flatMap((p) => p.messages) ?? [],
    [history.data],
  );

  // 화면에 보이고 창에 초점이 있을 때 가장 최신 메시지까지 읽음으로 표시한다.
  const latestId = messages[0]?.id ?? null;
  useEffect(() => {
    if (!latestId || !hasUnread({ lastMessageId: latestId, lastReadMessageId })) return;
    const mark = () => {
      if (document.visibilityState === 'visible' && document.hasFocus()) {
        void markChannelRead(queryClient, channelId, latestId);
      }
    };
    const timer = setTimeout(mark, 300);
    window.addEventListener('focus', mark);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', mark);
    };
  }, [channelId, latestId, lastReadMessageId, queryClient]);

  const send = useCallback(
    (content: string, clientId: string = crypto.randomUUID()) => {
      setPending((list) => [
        ...list.filter((p) => p.clientId !== clientId),
        { clientId, content, status: 'sending' },
      ]);
      const fail = () =>
        setPending((list) =>
          list.map((p) => (p.clientId === clientId ? { ...p, status: 'failed' } : p)),
        );
      if (!socket) return fail();
      socket
        .timeout(SEND_TIMEOUT_MS)
        .emit(SocketEvent.MessageSend, { channelId, content }, (err, result) => {
          if (err || !result.ok) return fail();
          addMessageToCache(queryClient, result.data as MessageDto);
          setPending((list) => list.filter((p) => p.clientId !== clientId));
        });
    },
    [channelId, queryClient, socket],
  );

  const retry = useCallback(
    (clientId: string) => {
      const target = pending.find((p) => p.clientId === clientId);
      if (target) send(target.content, clientId);
    },
    [pending, send],
  );

  const onTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSent.current < TYPING_THROTTLE_MS) return;
    lastTypingSent.current = now;
    socket?.emit(SocketEvent.TypingStart, { channelId });
  }, [channelId, socket]);

  const loadMore = useCallback(() => void history.fetchNextPage(), [history]);

  return (
    <section className="chat" aria-label={`${prefix}${title}`}>
      <header className="chat__header">
        <span className="chat__prefix">{prefix}</span>
        <h1>{title}</h1>
      </header>
      {history.isError ? (
        <p className="chat__error" role="alert">
          메시지를 불러오지 못했습니다.
        </p>
      ) : (
        <MessageList
          messages={messages}
          pending={pending}
          me={me}
          hasMore={history.hasNextPage}
          loadingMore={history.isFetchingNextPage || history.isPending}
          onLoadMore={loadMore}
          onRetry={retry}
          emptyText={`${prefix}${title}의 첫 메시지를 남겨 보세요.`}
        />
      )}
      <TypingIndicator channelId={channelId} people={people} />
      <Composer
        placeholder={`${prefix}${title}에 메시지 보내기`}
        onSend={send}
        onTyping={onTyping}
      />
    </section>
  );
}

function TypingIndicator({ channelId, people }: { channelId: string; people: UserProfile[] }) {
  const userIds = useTypingUsers(channelId);
  const names = userIds.map((id) => {
    const person = people.find((p) => p.id === id);
    return person ? displayName(person) : '누군가';
  });
  let text = '';
  if (names.length === 1) text = `${names[0]}님이 입력 중…`;
  else if (names.length === 2) text = `${names[0]}님과 ${names[1]}님이 입력 중…`;
  else if (names.length > 2) text = '여러 명이 입력 중…';
  return (
    <div className="typing" aria-live="polite">
      {text}
    </div>
  );
}
