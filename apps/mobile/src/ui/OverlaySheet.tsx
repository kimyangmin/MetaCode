import { type ReactNode, useEffect } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from './theme';

/**
 * 화면 위에 겹쳐 아래에서 올라오는 시트. `Sheet`(RN Modal)와 같은 모양이지만 앱 화면 안에 그린다:
 * 안드로이드에서 Modal 안의 Skia 캔버스는 그려지지 않아서, 캐릭터 미리보기가 들어가는 시트는 이것을 쓴다.
 * 바깥을 누르거나 뒤로 가기로 닫는다. 앱 화면 맨 위(서랍보다 위)에 두어야 한다.
 */
export function OverlaySheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose(): void;
  children: ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  // 겉 View는 늘 두어 닫을 때 사라지는 애니메이션(exiting)이 돈다. 닫혀 있으면 터치는 아래로 지나간다
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {visible && (
        <>
          <Animated.View
            entering={FadeIn.duration(150)}
            exiting={FadeOut.duration(150)}
            style={StyleSheet.absoluteFill}
          >
            <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="닫기" />
          </Animated.View>
          <Animated.View
            entering={SlideInDown.duration(200)}
            exiting={SlideOutDown.duration(180)}
            style={[
              styles.sheet,
              { backgroundColor: theme.bgSidebar, paddingBottom: insets.bottom + 16 },
            ]}
          >
            <View style={[styles.handle, { backgroundColor: theme.border }]} />
            {children}
          </Animated.View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 8,
    gap: 12,
  },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: 4 },
});
