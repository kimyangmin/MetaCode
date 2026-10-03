import type { Bubble } from '@metacode/client';
import { ImageIcon, MicOff, MonitorUp, Paperclip, Phone, Volume2 } from 'lucide-react-native';
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import type { ActorVoice } from '@metacode/client';
import { mc } from '../../ui/theme';

/** 캐릭터 머리 위 자리 (화면 단위). 프레임마다 그리는 쪽이 고친다 */
export type Heads = Record<string, { x: number; y: number }>;

export interface ActorLabel {
  id: string;
  name: string;
  isMe: boolean;
  bubbles: Bubble[];
  voice: ActorVoice | null;
}

/** 말풍선·이름표의 폭 (가운데를 머리 위에 맞춘다) */
const LABEL_WIDTH = 220;
const MARGIN = 4;

/**
 * 캐릭터 위의 이름표와 말풍선 (웹은 DOM 덮개). 글자는 도트 배율로 키우지 않고 화면 해상도로 그린다.
 * 자리만 프레임마다 바뀌므로 공유 값(heads)으로 옮기고, 글이 바뀔 때만 다시 그린다.
 */
export const ActorOverlay = memo(function ActorOverlay({
  labels,
  heads,
  viewWidth,
}: {
  labels: ActorLabel[];
  heads: SharedValue<Heads>;
  viewWidth: SharedValue<number>;
}) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {labels.map((label) => (
        <ActorTag key={label.id} label={label} heads={heads} viewWidth={viewWidth} />
      ))}
    </View>
  );
});

function ActorTag({
  label,
  heads,
  viewWidth,
}: {
  label: ActorLabel;
  heads: SharedValue<Heads>;
  viewWidth: SharedValue<number>;
}) {
  const bubblesWidth = useSharedValue(0);
  const id = label.id;
  const rootStyle = useAnimatedStyle(() => {
    const head = heads.get()[id];
    if (!head) return { opacity: 0 };
    return {
      opacity: 1,
      transform: [{ translateX: Math.round(head.x) }, { translateY: Math.round(head.y) }],
      zIndex: Math.round(head.y),
    };
  });
  // 패널 가장자리에서는 말풍선을 안쪽으로 민다 (꼬리는 캐릭터를 가리킨다)
  const bubbleStyle = useAnimatedStyle(() => {
    const head = heads.get()[id];
    const half = bubblesWidth.get() / 2;
    if (!head || half === 0) return { transform: [{ translateX: 0 }] };
    const x = head.x;
    const shift =
      Math.min(
        Math.max(x, MARGIN + half),
        Math.max(MARGIN + half, viewWidth.get() - MARGIN - half),
      ) - x;
    return { transform: [{ translateX: Math.round(shift) }] };
  });
  const tailStyle = useAnimatedStyle(() => {
    const head = heads.get()[id];
    const half = bubblesWidth.get() / 2;
    if (!head || half === 0) return { transform: [{ translateX: 0 }] };
    const x = head.x;
    const shift =
      Math.min(
        Math.max(x, MARGIN + half),
        Math.max(MARGIN + half, viewWidth.get() - MARGIN - half),
      ) - x;
    return {
      transform: [{ translateX: Math.round(Math.max(-(half - 10), Math.min(half - 10, -shift))) }],
    };
  });

  const { voice } = label;
  const speaking = !!voice?.speaking && !voice.muted;
  return (
    <Animated.View style={[styles.anchor, rootStyle]}>
      <View style={styles.stack}>
        {label.bubbles.length > 0 && (
          <Animated.View
            style={[styles.bubbles, bubbleStyle]}
            onLayout={(e) => bubblesWidth.set(e.nativeEvent.layout.width)}
          >
            {label.bubbles.map((bubble) => (
              <View
                key={bubble.id}
                style={[styles.bubble, bubble.kind === 'attachment-emote' && styles.emote]}
              >
                {bubble.label && <Text style={styles.bubbleLabel}>{bubble.label}</Text>}
                <View style={styles.bubbleRow}>
                  {bubble.icon &&
                    (bubble.icon === 'image' ? (
                      <ImageIcon color={mc.ink} size={13} />
                    ) : (
                      <Paperclip color={mc.ink} size={13} />
                    ))}
                  <Text style={styles.bubbleText}>{bubble.text}</Text>
                </View>
              </View>
            ))}
            <Animated.View style={[styles.tail, tailStyle]} />
          </Animated.View>
        )}
        {voice && (
          <View style={styles.voice}>
            {voice.label.kind === 'channel' ? (
              <Volume2 color="#fff" size={11} />
            ) : (
              <Phone color="#fff" size={11} />
            )}
            <Text style={styles.voiceText} numberOfLines={1}>
              {voice.label.name}
            </Text>
            {voice.sharing && <MonitorUp color="#fff" size={11} />}
            {voice.muted && <MicOff color="#fff" size={11} />}
          </View>
        )}
        <Text
          style={[styles.name, label.isMe && styles.me, speaking && { borderColor: '#3fb950' }]}
          numberOfLines={1}
        >
          {label.name}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // 머리 위 한 점. 안의 내용은 그 점 위로 쌓고 가운데를 맞춘다
  anchor: { position: 'absolute', left: 0, top: 0, width: 0, height: 0 },
  stack: {
    position: 'absolute',
    bottom: 0,
    left: -LABEL_WIDTH / 2,
    width: LABEL_WIDTH,
    alignItems: 'center',
    gap: 3,
  },
  bubbles: { alignItems: 'center', gap: 3, maxWidth: LABEL_WIDTH, paddingBottom: 5 },
  bubble: {
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    maxWidth: LABEL_WIDTH,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.15)',
  },
  emote: { backgroundColor: '#fff7e6' },
  bubbleLabel: { fontSize: 10, color: '#5b6573', fontWeight: '700' },
  bubbleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bubbleText: { fontSize: 13, color: mc.ink, flexShrink: 1 },
  tail: {
    position: 'absolute',
    bottom: 0,
    alignSelf: 'center',
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#fff',
  },
  voice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    maxWidth: LABEL_WIDTH,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 6,
    backgroundColor: 'rgba(17,22,29,0.75)',
  },
  voiceText: { fontSize: 10, color: '#fff', flexShrink: 1 },
  name: {
    fontSize: 11,
    color: '#fff',
    backgroundColor: 'rgba(17,22,29,0.7)',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: 5,
    paddingVertical: 1,
    overflow: 'hidden',
    maxWidth: LABEL_WIDTH,
  },
  me: { color: mc.ember },
});
