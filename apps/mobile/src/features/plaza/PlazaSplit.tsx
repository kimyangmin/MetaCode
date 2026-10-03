import type { PlazaId, UserProfile } from '@metacode/shared';
import { type ReactNode, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSharedValue } from 'react-native-reanimated';
import { useUiStore } from '../../stores/ui';
import { useTheme } from '../../ui/theme';
import { PlazaView } from './PlazaView';

/** 광장과 채팅의 최소 높이 (웹 휴대폰 화면: 광장 140px) */
const PLAZA_MIN = 140;
const CHAT_MIN = 180;
/** 처음 광장 높이: 나눌 높이의 이만큼 */
const PLAZA_DEFAULT = 0.4;

export interface PlazaTarget {
  plazaId: PlazaId;
  me: UserProfile;
  channelLabels: ReadonlyMap<string, string | null>;
}

/**
 * 광장(위)과 채팅(아래) 나누기. 가운데 막대를 끌어 높이를 바꾸고(앱을 켜 둔 동안 기억), 광장을 끄면 채팅만.
 * 광장은 끄면 내려서(그리기와 광장 구독을 멈춤) 다시 켜면 새로 연다.
 */
export function PlazaSplit({
  plaza,
  children,
}: {
  plaza: PlazaTarget | null;
  children: ReactNode;
}) {
  const theme = useTheme();
  const [total, setTotal] = useState(0);
  const saved = useUiStore((s) => s.plazaHeight);
  const dragStart = useSharedValue(0);
  const clamp = (h: number) => Math.max(PLAZA_MIN, Math.min(h, total - CHAT_MIN));
  const height = total > 0 ? clamp(saved ?? total * PLAZA_DEFAULT) : 0;

  const drag = Gesture.Pan()
    .runOnJS(true)
    .minDistance(2)
    .onBegin(() => dragStart.set(height))
    .onUpdate((e) => {
      useUiStore.getState().setPlazaHeight(clamp(dragStart.get() + e.translationY));
    });

  return (
    <View style={styles.root} onLayout={(e) => setTotal(e.nativeEvent.layout.height)}>
      {plaza && total > 0 && (
        <>
          <View style={{ height }}>
            <PlazaView
              key={plaza.plazaId}
              plazaId={plaza.plazaId}
              me={plaza.me}
              channelLabels={plaza.channelLabels}
            />
          </View>
          <GestureDetector gesture={drag}>
            <View
              style={[
                styles.divider,
                { backgroundColor: theme.bgSidebar, borderColor: theme.border },
              ]}
              accessibilityRole="adjustable"
              accessibilityLabel="광장과 채팅 나누기"
            >
              <View style={[styles.grip, { backgroundColor: theme.muted }]} />
            </View>
          </GestureDetector>
        </>
      )}
      <View style={styles.chat}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  divider: {
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  grip: { width: 36, height: 4, borderRadius: 2, opacity: 0.6 },
  chat: { flex: 1 },
});
