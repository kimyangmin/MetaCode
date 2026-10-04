import { ArrowUp } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

/** 조이스틱 판 지름과 손잡이가 움직일 수 있는 거리 */
const PAD = 112;
const KNOB = 48;
const REACH = (PAD - KNOB) / 2;
/** 이보다 조금 기울이면 움직이지 않는다 (손가락을 댄 채 떨림) */
const DEAD_ZONE = 0.25;

/**
 * 광장의 손가락 조작: 왼쪽 아래 조이스틱 (탑다운은 여덟 방향 어디로나, 횡스크롤은 좌우와 아래 = 발판에서 내려가기),
 * 횡스크롤이면 오른쪽 아래 점프 버튼 (누르고 있으면 높이 뛴다).
 * 값은 화면 쪽이 프레임마다 읽는다 (onStick, onJump). 서랍 열기 밀기보다 먼저 잡힌다.
 */
export function PlazaControls({
  side,
  onStick,
  onJump,
}: {
  side: boolean;
  /** 기울인 방향 (-1~1). 떼면 0, 0 */
  onStick(dx: number, dy: number): void;
  /** 점프 버튼을 눌렀다(true) 뗐다(false) */
  onJump(down: boolean): void;
}) {
  const knobX = useSharedValue(0);
  const knobY = useSharedValue(0);

  const report = (x: number, y: number) => {
    const length = Math.hypot(x, y) / REACH;
    if (length < DEAD_ZONE) {
      onStick(0, 0);
      return;
    }
    onStick(x / REACH, y / REACH);
  };

  const stick = Gesture.Pan()
    .minDistance(0)
    .runOnJS(true)
    .onBegin((e) => move(e.x - PAD / 2, e.y - PAD / 2))
    .onUpdate((e) => move(e.x - PAD / 2, e.y - PAD / 2))
    .onFinalize(() => {
      knobX.set(withTiming(0, { duration: 120 }));
      knobY.set(withTiming(0, { duration: 120 }));
      onStick(0, 0);
    });

  function move(x: number, y: number) {
    const length = Math.hypot(x, y);
    const k = length > REACH ? REACH / length : 1;
    knobX.set(x * k);
    knobY.set(y * k);
    report(x * k, y * k);
  }

  const jump = Gesture.LongPress()
    .minDuration(0)
    .maxDistance(200)
    .runOnJS(true)
    .onBegin(() => onJump(true))
    .onFinalize(() => onJump(false));

  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: knobX.get() }, { translateY: knobY.get() }],
  }));

  return (
    <>
      <GestureDetector gesture={stick}>
        <View style={styles.pad} accessibilityLabel="이동 조이스틱">
          <Animated.View style={[styles.knob, knobStyle]} />
        </View>
      </GestureDetector>
      {side && (
        <GestureDetector gesture={jump}>
          <View style={styles.jump} accessibilityRole="button" accessibilityLabel="점프">
            <ArrowUp color="#fff" size={26} />
          </View>
        </GestureDetector>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  pad: {
    position: 'absolute',
    left: 16,
    bottom: 16,
    width: PAD,
    height: PAD,
    borderRadius: PAD / 2,
    backgroundColor: 'rgba(17,22,29,0.25)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  knob: {
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: 'rgba(255,255,255,0.75)',
  },
  jump: {
    position: 'absolute',
    right: 20,
    bottom: 28,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(17,22,29,0.4)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
