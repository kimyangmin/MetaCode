import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, TextField } from '../../ui/controls';
import { Sheet } from '../../ui/Sheet';
import { useTheme } from '../../ui/theme';

/** 고르기 쉬운 색: 회색 단계 + 열 가지 색상의 밝은·가운데·어두운 단계 */
const PRESETS = [
  '#000000',
  '#3a3a3a',
  '#6b6b6b',
  '#9c9c9c',
  '#cfcfcf',
  '#ffffff',
  ...[0, 30, 50, 90, 140, 180, 210, 240, 280, 320].flatMap((hue) =>
    [80, 55, 32].map((light) => hsl(hue, 70, light)),
  ),
];

function hsl(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

const HEX = /^#[0-9a-f]{6}$/;

/**
 * 팔레트 색 더하기·바꾸기 (웹은 색 입력칸): 정해 둔 색에서 고르거나 #rrggbb를 적는다. 바꾸는 중이면 지우기도
 * (지운 색으로 칠한 픽셀은 투명이 됨).
 */
export function ColorSheet({
  initial,
  canRemove,
  onApply,
  onRemove,
  onClose,
}: {
  /** 바꿀 색 (더할 때는 null) */
  initial: string | null;
  canRemove: boolean;
  onApply(hex: string): void;
  onRemove(): void;
  onClose(): void;
}) {
  const theme = useTheme();
  const [hex, setHex] = useState(initial ?? '#ff8800');
  const normalized = (hex.startsWith('#') ? hex : `#${hex}`).toLowerCase();
  const valid = HEX.test(normalized);
  return (
    <Sheet visible title={initial ? '색 바꾸기' : '색 더하기'} onClose={onClose}>
      <View style={styles.presets}>
        {PRESETS.map((color) => (
          <Pressable
            key={color}
            onPress={() => setHex(color)}
            accessibilityRole="button"
            accessibilityLabel={color}
            style={[
              styles.preset,
              {
                backgroundColor: color,
                borderColor: normalized === color ? theme.fg : theme.border,
              },
            ]}
          />
        ))}
      </View>
      <View style={styles.row}>
        <View
          style={[
            styles.sample,
            { backgroundColor: valid ? normalized : 'transparent', borderColor: theme.border },
          ]}
        />
        <View style={{ flex: 1 }}>
          <TextField
            value={hex}
            onChangeText={setHex}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={7}
            placeholder="#rrggbb"
          />
        </View>
      </View>
      {!valid && (
        <Text style={{ color: theme.danger, fontSize: 12 }}>#rrggbb 모양으로 적어 주세요.</Text>
      )}
      <View style={styles.row}>
        {initial && canRemove && (
          <View style={{ flex: 1 }}>
            <Button label="이 색 지우기" variant="danger" onPress={onRemove} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Button
            label={initial ? '바꾸기' : '더하기'}
            variant="primary"
            disabled={!valid}
            onPress={() => onApply(normalized)}
          />
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  preset: { width: 30, height: 30, borderRadius: 6, borderWidth: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sample: { width: 44, height: 44, borderRadius: 8, borderWidth: 1 },
});
