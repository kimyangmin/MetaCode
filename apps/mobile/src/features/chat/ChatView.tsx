import { addMessageToCache, displayName, queryKeys, useTypingUsers } from '@metacode/client';
import {
  type MessageDto,
  SocketEvent,
  type SocketAck,
  TYPING_THROTTLE_MS,
  type UserProfile,
  hasUnread,
} from '@metacode/shared';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, KeyboardAvoidingView, StyleSheet, Text, View } from 'react-native';
import { fetchMessages, markChannelRead } from '../../api/queries';
import { type AppSocket, useRealtime } from '../../realtime/RealtimeProvider';
import { MentionPeople } from '../../ui/Markdown';
import { useTheme } from '../../ui/theme';
import { Composer } from './Composer';
import { ForwardSheet } from './ForwardSheet';
import { MessageActions } from './MessageActions';
import { MessageList, type PendingMessage } from './MessageList';
import { useAttachmentDrafts } from './uploads';

const SEND_TIMEOUT_MS = 10_000;

/**
 * 채팅 모드: 한 채널의 대화 기록, 입력 중 표시, 입력창 (웹 ChatView와 같은 흐름).
 * 메시지 보내기·고치기·지우기·전달은 소켓(ack), 기록과 읽음 표시는 HTTP.
 */
export function ChatView({
  channelId,
  title,
  me,
  lastReadMessageId,
  people,
  canDeleteOthers,
}: {
  channelId: string;
  /** 입력칸 안내에 쓴다 (#일반, 상대 이름) */
  title: string;
  me: UserProfile;
  lastReadMessageId: string | null;
  /** 이 채널의 사람들 (입력 중 표시, 멘션 표시) */
  people: UserProfile[];
  /** 커뮤니티 소유자·관리자: 남의 메시지도 지울 수 있음 (서버도 같은 규칙) */
  canDeleteOthers: boolean;
}) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { socket } = useRealtime();
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [replyTo, setReplyTo] = useState<MessageDto | null>(null);
  const [editing, setEditing] = useState<MessageDto | null>(null);
  const [menu, setMenu] = useState<MessageDto | null>(null);
  const [forwarding, setForwarding] = useState<MessageDto | null>(null);
  const lastTypingSent = useRef(0);
  const drafts = useAttachmentDrafts(channelId);

  const history = useInfiniteQuery({
    queryKey: queryKeys.messages(channelId),
    queryFn: ({ pageParam }) => fetchMessages(channelId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasMore ? last.messages.at(-1)?.id : undefined),
    // 실시간 이벤트로 최신 상태를 유지하고, 재연결하면 다시 불러온다
    staleTime: Infinity,
  });
  const messages = useMemo(
    () => history.data?.pages.flatMap((p) => p.messages) ?? [],
    [history.data],
  );

  // 앱이 앞에 있는 동안 가장 최신 메시지까지 읽음으로 표시한다
  const latestId = messages[0]?.id ?? null;
  useEffect(() => {
    if (!latestId || !hasUnread({ lastMessageId: latestId, lastReadMessageId })) return;
    const mark = () => {
      if (AppState.currentState === 'active') {
        void markChannelRead(queryClient, channelId, latestId).catch(() => undefined);
      }
    };
    const timer = setTimeout(mark, 300);
    const sub = AppState.addEventListener('change', (state) => state === 'active' && mark());
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, [channelId, latestId, lastReadMessageId, queryClient]);

  const deliver = useCallback(
    (content: string, attachmentIds: string[], clientId: string, replyToId?: string) => {
      setPending((list) => [
        ...list.filter((p) => p.clientId !== clientId),
        { clientId, content, attachmentIds, replyToId, status: 'sending' },
      ]);
      const fail = () =>
        setPending((list) =>
          list.map((p) => (p.clientId === clientId ? { ...p, status: 'failed' } : p)),
        );
      if (!socket) return fail();
      socket
        .timeout(SEND_TIMEOUT_MS)
        .emit(
          SocketEvent.MessageSend,
          { channelId, content, attachmentIds, replyToId },
          (err, result) => {
            if (err || !result.ok) return fail();
            addMessageToCache(queryClient, result.data, me.id);
            setPending((list) => list.filter((p) => p.clientId !== clientId));
          },
        );
    },
    [channelId, me.id, queryClient, socket],
  );

  const send = (content: string) => {
    if (editing) {
      void request(socket, SocketEvent.MessageEdit, { messageId: editing.id, content }).then(
        (error) => error && Alert.alert('고치지 못했습니다', error),
      );
      setEditing(null);
      return;
    }
    deliver(
      content,
      drafts.readyAttachments.map((a) => a.id),
      Crypto.randomUUID(),
      replyTo?.id,
    );
    drafts.clear();
    setReplyTo(null);
  };

  const retry = (clientId: string) => {
    const target = pending.find((p) => p.clientId === clientId);
    if (target) deliver(target.content, target.attachmentIds, clientId, target.replyToId);
  };

  const remove = (message: MessageDto) =>
    Alert.alert('메시지 삭제', '이 메시지를 지울까요? 첨부도 함께 지워집니다.', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () =>
          void request(socket, SocketEvent.MessageDelete, { messageId: message.id }).then(
            (error) => error && Alert.alert('지우지 못했습니다', error),
          ),
      },
    ]);

  const onTyping = () => {
    const now = Date.now();
    if (now - lastTypingSent.current < TYPING_THROTTLE_MS) return;
    lastTypingSent.current = now;
    socket?.emit(SocketEvent.TypingStart, { channelId });
  };

  return (
    <MentionPeople.Provider value={people}>
      <KeyboardAvoidingView behavior="padding" style={[styles.root, { backgroundColor: theme.bg }]}>
        {history.isError ? (
          <View style={styles.center}>
            <Text style={{ color: theme.danger }}>메시지를 불러오지 못했습니다.</Text>
          </View>
        ) : (
          <MessageList
            messages={messages}
            pending={pending}
            me={me}
            loading={history.isPending}
            loadingMore={history.isFetchingNextPage}
            hasMore={history.hasNextPage}
            onLoadMore={() => void history.fetchNextPage()}
            onRetry={retry}
            onReply={setReplyTo}
            onMenu={setMenu}
            emptyText={`${title}의 첫 메시지를 남겨 보세요.`}
          />
        )}
        <TypingIndicator channelId={channelId} people={people} />
        <Composer
          key={editing?.id ?? 'new'}
          placeholder={`${title}에 메시지 보내기`}
          initialText={editing?.content ?? ''}
          editing={editing !== null}
          onCancelEdit={() => setEditing(null)}
          drafts={drafts}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onSend={send}
          onTyping={onTyping}
        />
        <MessageActions
          message={menu}
          mine={menu?.author.id === me.id}
          canDelete={menu !== null && (menu.author.id === me.id || canDeleteOthers)}
          onClose={() => setMenu(null)}
          onReply={(m) => (setEditing(null), setReplyTo(m))}
          onForward={setForwarding}
          onEdit={(m) => (setReplyTo(null), setEditing(m))}
          onDelete={remove}
        />
        <ForwardSheet message={forwarding} onClose={() => setForwarding(null)} />
      </KeyboardAvoidingView>
    </MentionPeople.Provider>
  );
}

function TypingIndicator({ channelId, people }: { channelId: string; people: UserProfile[] }) {
  const theme = useTheme();
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
    <Text style={[styles.typing, { color: theme.muted }]} numberOfLines={1}>
      {text}
    </Text>
  );
}

/** 메시지 고치기·지우기 요청. 실패하면 알릴 문구, 성공하면 null (목록은 서버의 알림으로 바뀐다) */
export async function request<
  E extends typeof SocketEvent.MessageEdit | typeof SocketEvent.MessageDelete,
>(
  socket: AppSocket | null,
  event: E,
  payload: E extends typeof SocketEvent.MessageEdit
    ? { messageId: string; content: string }
    : { messageId: string },
): Promise<string | null> {
  if (!socket?.connected) return '서버에 연결되어 있지 않습니다.';
  try {
    const ack = (await socket
      .timeout(SEND_TIMEOUT_MS)
      // 이벤트마다 ack 타입이 달라서 여기서는 공통 모양으로 받는다
      .emitWithAck(
        event as typeof SocketEvent.MessageDelete,
        payload as { messageId: string },
      )) as SocketAck<unknown>;
    return ack.ok ? null : ack.error;
  } catch {
    return '서버가 응답하지 않습니다.';
  }
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  typing: { fontSize: 12, paddingHorizontal: 16, height: 18 },
});
