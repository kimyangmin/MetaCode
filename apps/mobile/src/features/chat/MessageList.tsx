import { formatDay, mentionsMe, sameDay } from '@metacode/client';
import type { MessageDto, UserProfile } from '@metacode/shared';
import { ArrowDown } from 'lucide-react-native';
import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { mc, useTheme } from '../../ui/theme';
import { MessageItem } from './MessageItem';

/** 같은 사람이 이 시간 안에 이어서 보낸 메시지는 이름·아바타 없이 붙여 보여 준다 (웹과 같음) */
const GROUP_WINDOW_MS = 5 * 60 * 1000;
/** 맨 아래에서 이만큼 넘게 올라가면 "맨 아래로" 버튼 (웹과 같음) */
const JUMP_BUTTON_OFFSET = 400;

export interface PendingMessage {
  clientId: string;
  content: string;
  attachmentIds: string[];
  replyToId?: string;
  status: 'sending' | 'failed';
}

type Row =
  | { kind: 'pending'; key: string; pending: PendingMessage }
  | { kind: 'message'; key: string; message: MessageDto; grouped: boolean; mentioned: boolean }
  | { kind: 'day'; key: string; label: string };

/**
 * 메시지 목록. 뒤집힌 목록(inverted)이라 맨 아래(최신)가 기준점이고, 위로 올리면 이전 기록을 불러온다
 * (웹은 column-reverse + IntersectionObserver).
 */
export function MessageList({
  messages,
  pending,
  me,
  loading,
  loadingMore,
  hasMore,
  onLoadMore,
  onRetry,
  onReply,
  onMenu,
  emptyText,
}: {
  /** 최신 메시지부터 */
  messages: MessageDto[];
  pending: PendingMessage[];
  me: UserProfile;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onLoadMore(): void;
  onRetry(clientId: string): void;
  onReply(message: MessageDto): void;
  onMenu(message: MessageDto): void;
  emptyText: string;
}) {
  const theme = useTheme();
  const list = useRef<FlatList<Row>>(null);
  // 위로 올라가 있을 때: 그때 가장 최신이던 메시지 (그 뒤로 온 메시지 수를 센다)
  const [away, setAway] = useState<{ newestId: string | null } | null>(null);

  const rows = useMemo<Row[]>(() => {
    // 뒤집힌 목록의 0번이 맨 아래다: 보내는 중인 메시지(최근 것이 맨 아래) → 메시지(최신부터) 순
    const out: Row[] = [...pending]
      .reverse()
      .map((p) => ({ kind: 'pending', key: `p:${p.clientId}`, pending: p }));
    messages.forEach((message, i) => {
      const previous = messages[i + 1];
      const newDay = !previous || !sameDay(previous.createdAt, message.createdAt);
      const grouped =
        !newDay &&
        previous.author.id === message.author.id &&
        !message.replyTo &&
        Date.parse(message.createdAt) - Date.parse(previous.createdAt) < GROUP_WINDOW_MS;
      out.push({
        kind: 'message',
        key: message.id,
        message,
        grouped,
        mentioned: mentionsMe(message, me),
      });
      if (newDay)
        out.push({ kind: 'day', key: `d:${message.id}`, label: formatDay(message.createdAt) });
    });
    return out;
  }, [messages, pending, me]);

  const newCount = away
    ? away.newestId
      ? messages.findIndex((m) => m.id === away.newestId)
      : messages.length
    : 0;

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = e.nativeEvent.contentOffset.y;
    if (offset > JUMP_BUTTON_OFFSET) {
      if (!away) setAway({ newestId: messages[0]?.id ?? null });
    } else if (away) {
      setAway(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.muted} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <FlatList
        ref={list}
        inverted
        data={rows}
        keyExtractor={(row) => row.key}
        onScroll={onScroll}
        scrollEventThrottle={64}
        onEndReached={() => hasMore && !loadingMore && onLoadMore()}
        onEndReachedThreshold={0.5}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator color={theme.muted} style={styles.more} />
          ) : !hasMore && rows.length === 0 ? (
            <Text style={[styles.empty, { color: theme.muted }]}>{emptyText}</Text>
          ) : null
        }
        renderItem={({ item: row }) => {
          if (row.kind === 'day') {
            return (
              <View style={styles.day}>
                <View style={[styles.dayLine, { backgroundColor: theme.border }]} />
                <Text style={[styles.dayText, { color: theme.muted }]}>{row.label}</Text>
                <View style={[styles.dayLine, { backgroundColor: theme.border }]} />
              </View>
            );
          }
          if (row.kind === 'pending') {
            const p = row.pending;
            return (
              <Pressable
                onPress={() => p.status === 'failed' && onRetry(p.clientId)}
                style={styles.pending}
              >
                <Text style={{ color: theme.muted, fontSize: 15 }}>
                  {p.content || `첨부 ${p.attachmentIds.length}개`}
                </Text>
                {p.status === 'failed' && (
                  <Text style={{ color: theme.danger, fontSize: 12 }}>
                    전송 실패 · 눌러서 다시 보내기
                  </Text>
                )}
              </Pressable>
            );
          }
          return (
            <MessageItem
              message={row.message}
              grouped={row.grouped}
              mentioned={row.mentioned}
              onReply={onReply}
              onMenu={onMenu}
            />
          );
        }}
      />
      {away && (
        <Pressable
          onPress={() => list.current?.scrollToOffset({ offset: 0, animated: true })}
          style={styles.jump}
          accessibilityRole="button"
          accessibilityLabel={newCount > 0 ? `새 메시지 ${newCount}개, 맨 아래로` : '맨 아래로'}
        >
          <ArrowDown color={mc.ink} size={22} />
          {newCount > 0 && (
            <View style={[styles.badge, { backgroundColor: theme.danger }]}>
              <Text style={styles.badgeText}>{newCount > 99 ? '99+' : newCount}</Text>
            </View>
          )}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingVertical: 8 },
  more: { marginVertical: 12 },
  empty: { textAlign: 'center', marginVertical: 24, paddingHorizontal: 24 },
  day: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 12,
    paddingHorizontal: 16,
  },
  dayLine: { flex: 1, height: StyleSheet.hairlineWidth },
  dayText: { fontSize: 12, fontWeight: '600' },
  pending: { paddingLeft: 64, paddingRight: 16, paddingVertical: 2, gap: 2 },
  // 웹의 "맨 아래로": 모닥불색 둥근 사각형 + 아래 그림자
  jump: {
    position: 'absolute',
    right: 14,
    bottom: 10,
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: mc.ember,
    borderBottomWidth: 3,
    borderBottomColor: '#c98f2c',
    elevation: 4,
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
