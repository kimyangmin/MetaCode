import {
  type MessageDto,
  SocketEvent,
  TYPING_THROTTLE_MS,
  type UserProfile,
  hasUnread,
} from '@metacode/shared';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import {
  type DragEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { addMessageToCache, fetchMessages, markChannelRead, queryKeys } from '../../api/queries';
import { useRealtime } from '../../realtime/RealtimeProvider';
import { useTypingUsers } from '../../stores/typing';
import { displayName } from '../../ui/format';
import { Composer } from './Composer';
import { MessageList, type PendingMessage } from './MessageList';
import { useAttachmentDrafts } from './uploads';

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
  /** 머리글 오른쪽 (보기 전환 버튼) */
  actions?: ReactNode;
}

/** 채팅 모드: 한 채널의 대화 기록, 입력 중 표시, 입력창 */
export function ChatView({
  channelId,
  title,
  prefix,
  me,
  lastReadMessageId,
  people,
  actions,
}: ChatViewProps) {
  const queryClient = useQueryClient();
  const { socket } = useRealtime();
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const lastTypingSent = useRef(0);
  const drafts = useAttachmentDrafts(channelId);
  const [dragging, setDragging] = useState(false);

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

  const deliver = useCallback(
    (content: string, attachmentIds: string[], clientId: string) => {
      setPending((list) => [
        ...list.filter((p) => p.clientId !== clientId),
        { clientId, content, attachmentIds, status: 'sending' },
      ]);
      const fail = () =>
        setPending((list) =>
          list.map((p) => (p.clientId === clientId ? { ...p, status: 'failed' } : p)),
        );
      if (!socket) return fail();
      socket
        .timeout(SEND_TIMEOUT_MS)
        .emit(SocketEvent.MessageSend, { channelId, content, attachmentIds }, (err, result) => {
          if (err || !result.ok) return fail();
          addMessageToCache(queryClient, result.data as MessageDto);
          setPending((list) => list.filter((p) => p.clientId !== clientId));
        });
    },
    [channelId, queryClient, socket],
  );

  /** 입력창의 글과, 올라간 첨부를 함께 보낸다. */
  const send = useCallback(
    (content: string) => {
      deliver(
        content,
        drafts.readyAttachments.map((a) => a.id),
        crypto.randomUUID(),
      );
      drafts.clear();
    },
    [deliver, drafts],
  );

  const retry = useCallback(
    (clientId: string) => {
      const target = pending.find((p) => p.clientId === clientId);
      if (target) deliver(target.content, target.attachmentIds, clientId);
    },
    [pending, deliver],
  );

  // 채팅 영역에 파일을 끌어 놓으면 첨부한다.
  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setDragging(true);
  };
  const onDragLeave = (e: DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
  };
  const onDrop = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setDragging(false);
    drafts.add([...e.dataTransfer.files]);
  };

  const onTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSent.current < TYPING_THROTTLE_MS) return;
    lastTypingSent.current = now;
    socket?.emit(SocketEvent.TypingStart, { channelId });
  }, [channelId, socket]);

  const loadMore = useCallback(() => void history.fetchNextPage(), [history]);

  return (
    <section
      className="chat"
      aria-label={`${prefix}${title}`}
      data-dragging={dragging}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="chat__drop" aria-hidden>
          여기에 놓으면 {prefix}
          {title}에 첨부합니다
        </div>
      )}
      <header className="chat__header">
        <span className="chat__prefix">{prefix}</span>
        <h1>{title}</h1>
        {actions && <div className="chat__actions">{actions}</div>}
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
        drafts={drafts.drafts}
        notice={drafts.notice}
        uploading={drafts.uploading}
        hasReadyAttachments={drafts.readyAttachments.length > 0}
        onSend={send}
        onTyping={onTyping}
        onAddFiles={drafts.add}
        onRemoveDraft={drafts.remove}
        onRetryDraft={drafts.retry}
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
