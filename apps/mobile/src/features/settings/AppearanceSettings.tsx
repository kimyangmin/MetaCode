import { StyleSheet, Text, View } from 'react-native';
import { type ColorSchemeChoice, useColorSchemeStore } from '../../stores/colorScheme';
import { Segmented } from '../../ui/controls';
import { useTheme } from '../../ui/theme';

/** 설정 → 화면 (웹 AppearanceSettings): 기기 설정 / 라이트 / 다크 */
export function AppearanceSettings() {
  const theme = useTheme();
  const choice = useColorSchemeStore((s) => s.choice);
  const set = useColorSchemeStore((s) => s.set);
  return (
    <View style={styles.root}>
      <Text style={[styles.label, { color: theme.muted }]}>밝기</Text>
      <Segmented<ColorSchemeChoice>
        value={choice}
        onChange={set}
        options={[
          { value: 'system', label: '기기 설정' },
          { value: 'light', label: '라이트' },
          { value: 'dark', label: '다크' },
        ]}
      />
      <Text style={[styles.hint, { color: theme.muted }]}>
        기기 설정이면 휴대폰의 다크 모드를 따라갑니다.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  label: { fontSize: 12, fontWeight: '700' },
  hint: { fontSize: 12 },
});
