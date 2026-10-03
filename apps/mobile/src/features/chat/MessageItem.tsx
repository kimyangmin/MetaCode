import { displayName, formatTime, markdownToPlain } from '@metacode/client';
import type { MessageDto } from '@metacode/shared';
import * as Haptics from 'expo-haptics';
import { Forward, Reply } from 'lucide-react-native';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Avatar } from '../../ui/Avatar';
import { Markdown } from '../../ui/Markdown';
import { mc, useTheme } from '../../ui/theme';
import { MessageAttachments } from './MessageAttachments';

/** 이만큼 넘게 왼쪽으로 밀었다 놓으면 답장 (웹 swipeReply.ts와 같은 56px) */
const REPLY_DISTANCE = 56;
/** 메시지가 손가락을 따라 나오는 최대 거리 */
const MAX_PULL = 96;

/**
 * 메시지 한 줄. 길게 누르면 메뉴(답장·전달·복사·고치기·지우기), 왼쪽으로 밀면 답장 (웹 휴대폰 화면과 같은 규칙:
 * 오른쪽 밀기는 목록 서랍이 받는다).
 */
export const MessageItem = memo(function MessageItem({
  message,
  grouped,
  mentioned,
  onReply,
  onMenu,
}: {
  message: MessageDto;
  grouped: boolean;
  /** 나를 부른 메시지 (@내아이디, 내 메시지에 단 답장) */
  mentioned: boolean;
  onReply(message: MessageDto): void;
  onMenu(message: MessageDto): void;
}) {
  const theme = useTheme();
  const dx = useSharedValue(0);
  const ready = useSharedValue(false);

  const tick = () => void Haptics.selectionAsync().catch(() => undefined);
  const reply = () => onReply(message);

  const swipe = Gesture.Pan()
    .activeOffsetX(-15)
    .failOffsetX(15)
    .failOffsetY([-10, 10])
    .onUpdate((e) => {
      const distance = Math.max(0, -e.translationX);
      // 답장 거리까지는 그대로, 그 뒤로는 덜 따라오다 MAX_PULL에서 멈춘다 (웹 replyPull)
      const pull =
        distance <= REPLY_DISTANCE
          ? distance
          : Math.min(MAX_PULL, REPLY_DISTANCE + (distance - REPLY_DISTANCE) * 0.35);
      dx.set(-pull);
      const over = distance >= REPLY_DISTANCE;
      if (over !== ready.get()) {
        ready.set(over);
        if (over) runOnJS(tick)();
      }
    })
    .onEnd(() => {
      if (ready.get()) runOnJS(reply)();
      ready.set(false);
      dx.set(withTiming(0, { duration: 180 }));
    });

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: dx.get() }] }));
  const iconStyle = useAnimatedStyle(() => {
    const progress = Math.min(1, -dx.get() / REPLY_DISTANCE);
    return {
      opacity: progress,
      transform: [{ scale: interpolate(progress, [0, 1], [0.6, 1]) }],
      backgroundColor: ready.get() ? theme.accent : theme.bgHover,
    };
  });

  return (
    <GestureDetector gesture={swipe}>
      <View style={styles.wrap}>
        <Animated.View style={[styles.replyIcon, iconStyle]} pointerEvents="none">
          <Reply color={theme.fg} size={18} />
        </Animated.View>
        <Animated.View style={rowStyle}>
          <Pressable
            onLongPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
              onMenu(message);
            }}
            delayLongPress={350}
            style={({ pressed }) => [
              styles.row,
              !grouped && styles.first,
              mentioned && { backgroundColor: 'rgba(253,190,83,0.10)' },
              pressed && { backgroundColor: theme.bgHover },
            ]}
          >
            {mentioned && <View style={[styles.mentionBar, { backgroundColor: mc.ember }]} />}
            {message.replyTo !== undefined && message.replyTo !== null && (
              <View style={styles.replyRow}>
                <Reply color={theme.muted} size={13} />
                <Text style={[styles.replyName, { color: theme.fg }]} numberOfLines={1}>
                  {displayName(message.replyTo.author)}
                </Text>
                <Text style={[styles.replyText, { color: theme.muted }]} numberOfLines={1}>
                  {message.replyTo.content
                    ? markdownToPlain(message.replyTo.content)
                    : `첨부 ${message.replyTo.attachmentCount}개`}
                </Text>
              </View>
            )}
            <View style={styles.body}>
              <View style={styles.gutter}>
                {!grouped && <Avatar user={message.author} size={40} />}
              </View>
              <View style={styles.main}>
                {!grouped && (
                  <View style={styles.header}>
                    <Text style={[styles.name, { color: theme.fg }]} numberOfLines={1}>
                      {displayName(message.author)}
                    </Text>
                    <Text style={[styles.time, { color: theme.muted }]}>
                      {formatTime(message.createdAt)}
                    </Text>
                  </View>
                )}
                {message.forwarded && (
                  <View style={styles.forwarded}>
                    <Forward color={theme.muted} size={13} />
                    <Text style={{ color: theme.muted, fontSize: 12, fontStyle: 'italic' }}>
                      전달됨
                    </Text>
                  </View>
                )}
                {message.content !== '' && <Markdown text={message.content} />}
                {message.editedAt && (
                  <Text style={[styles.edited, { color: theme.muted }]}>(수정됨)</Text>
                )}
                {message.attachments.length > 0 && (
                  <MessageAttachments attachments={message.attachments} />
                )}
              </View>
            </View>
          </Pressable>
        </Animated.View>
      </View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden' },
  replyIcon: {
    position: 'absolute',
    right: 14,
    top: '50%',
    marginTop: -16,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { paddingVertical: 2, paddingRight: 16 },
  first: { marginTop: 10 },
  mentionBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  replyRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginLeft: 64, marginBottom: 2 },
  replyName: { fontSize: 12, fontWeight: '700', flexShrink: 0, maxWidth: '40%' },
  replyText: { fontSize: 12, flex: 1 },
  body: { flexDirection: 'row' },
  gutter: { width: 64, alignItems: 'center', paddingTop: 2 },
  main: { flex: 1, minWidth: 0, gap: 2 },
  header: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  name: { fontSize: 15, fontWeight: '700', flexShrink: 1 },
  time: { fontSize: 11 },
  forwarded: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  edited: { fontSize: 11 },
});
