import { type ReactNode, useEffect } from 'react';
import { BackHandler, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useUiStore } from '../stores/ui';

/** 이만큼 넘게 밀거나 빠르게 튕기면 연다·닫는다 (웹 drawerSwipe.ts와 같은 60px) */
const SWIPE_DISTANCE = 60;
const FLING_VELOCITY = 600;
const DURATION = 220;
/** 커뮤니티 막대 폭 */
export const RAIL_WIDTH = 72;

/**
 * 화면 틀: 가운데 화면 + 왼쪽 서랍(커뮤니티 막대 + 채널·DM 목록) + 오른쪽 서랍(멤버 목록).
 * - 서랍이 모두 닫혀 있으면 화면 어디서든 오른쪽으로 밀어 왼쪽 서랍을 연다 (메시지를 왼쪽으로 밀면 답장이라 겹치지 않음).
 * - 열린 서랍은 바깥쪽으로 밀거나 어두운 곳을 누르거나 뒤로 가기로 닫는다.
 * - 미는 동안 서랍이 손가락을 따라오고 배경이 나온 만큼 어두워진다.
 */
export function AppShell({
  children,
  nav,
  members,
}: {
  children: ReactNode;
  nav: ReactNode;
  /** 커뮤니티 화면일 때만 */
  members: ReactNode | null;
}) {
  const { width: screenWidth } = useWindowDimensions();
  const navWidth = RAIL_WIDTH + Math.min(300, screenWidth - RAIL_WIDTH - 40);
  const membersWidth = Math.min(280, screenWidth * 0.85);

  const navOpen = useUiStore((s) => s.navOpen);
  const membersOpen = useUiStore((s) => s.membersOpen);
  const navP = useSharedValue(0);
  const membersP = useSharedValue(0);

  useEffect(() => {
    navP.set(withTiming(navOpen ? 1 : 0, { duration: DURATION }));
  }, [navOpen, navP]);
  useEffect(() => {
    membersP.set(withTiming(membersOpen ? 1 : 0, { duration: DURATION }));
  }, [membersOpen, membersP]);

  // 안드로이드 뒤로 가기: 서랍이 열려 있으면 닫는다
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const ui = useUiStore.getState();
      if (!ui.navOpen && !ui.membersOpen) return false;
      ui.closeDrawers();
      return true;
    });
    return () => sub.remove();
  }, []);

  const setNav = (open: boolean) => {
    useUiStore.getState().setNavOpen(open);
    // 같은 값이면 effect가 돌지 않으므로 여기서도 제자리로 돌려놓는다
    navP.set(withTiming(open ? 1 : 0, { duration: DURATION }));
  };
  const setMembers = (open: boolean) => {
    useUiStore.getState().setMembersOpen(open);
    membersP.set(withTiming(open ? 1 : 0, { duration: DURATION }));
  };

  // 닫힌 왼쪽 서랍을 오른쪽으로 밀어 열기
  const openNav = Gesture.Pan()
    .enabled(!navOpen && !membersOpen)
    .activeOffsetX(15)
    .failOffsetX(-15)
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      navP.set(Math.min(1, Math.max(0, e.translationX / navWidth)));
    })
    .onEnd((e) => {
      const open = e.translationX > SWIPE_DISTANCE || e.velocityX > FLING_VELOCITY;
      runOnJS(setNav)(open);
    });

  // 열린 왼쪽 서랍을 왼쪽으로 밀어 닫기
  const closeNav = Gesture.Pan()
    .activeOffsetX(-15)
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      navP.set(1 + Math.min(0, e.translationX) / navWidth);
    })
    .onEnd((e) => {
      const close = -e.translationX > SWIPE_DISTANCE || -e.velocityX > FLING_VELOCITY;
      runOnJS(setNav)(!close);
    });

  // 열린 멤버 서랍을 오른쪽으로 밀어 닫기
  const closeMembers = Gesture.Pan()
    .activeOffsetX(15)
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      membersP.set(1 - Math.max(0, e.translationX) / membersWidth);
    })
    .onEnd((e) => {
      const close = e.translationX > SWIPE_DISTANCE || e.velocityX > FLING_VELOCITY;
      runOnJS(setMembers)(!close);
    });

  const navStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (navP.get() - 1) * navWidth }],
  }));
  const membersStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (1 - membersP.get()) * membersWidth }],
  }));
  const backdropStyle = useAnimatedStyle(() => {
    const p = Math.max(navP.get(), membersP.get());
    return { opacity: interpolate(p, [0, 1], [0, 0.5]), display: p > 0 ? 'flex' : 'none' };
  });

  return (
    <View style={styles.root}>
      <GestureDetector gesture={openNav}>
        <View style={styles.root}>{children}</View>
      </GestureDetector>

      <GestureDetector gesture={navOpen ? closeNav : closeMembers}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => useUiStore.getState().closeDrawers()}
            accessibilityLabel="서랍 닫기"
          />
        </Animated.View>
      </GestureDetector>

      <GestureDetector gesture={closeNav}>
        <Animated.View style={[styles.nav, { width: navWidth }, navStyle]}>{nav}</Animated.View>
      </GestureDetector>

      {members && (
        <GestureDetector gesture={closeMembers}>
          <Animated.View style={[styles.members, { width: membersWidth }, membersStyle]}>
            {members}
          </Animated.View>
        </GestureDetector>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { backgroundColor: '#000' },
  nav: { position: 'absolute', top: 0, bottom: 0, left: 0, elevation: 16 },
  members: { position: 'absolute', top: 0, bottom: 0, right: 0, elevation: 16 },
});
