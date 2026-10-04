import type { ComponentType } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../../ui/theme';

/** 에디터 머리글의 아이콘 버튼과 도구 막대의 버튼 (도트 에디터, 맵 에디터) */

export function IconButton({
  icon: Icon,
  label,
  disabled,
  onPress,
}: {
  icon: ComponentType<{ color: string; size: number }>;
  label: string;
  disabled?: boolean;
  onPress(): void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.icon,
        { opacity: disabled ? 0.35 : 1 },
        pressed && { backgroundColor: theme.bgHover },
      ]}
    >
      <Icon color={theme.fg} size={20} />
    </Pressable>
  );
}

export function ToolButton({
  icon: Icon,
  label,
  active,
  onPress,
}: {
  icon: ComponentType<{ color: string; size: number }>;
  label: string;
  active: boolean;
  onPress(): void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={[styles.tool, { backgroundColor: active ? theme.accent : theme.bgInput }]}
    >
      <Icon color={active ? theme.accentFg : theme.fg} size={20} />
    </Pressable>
  );
}

export const toolStyle = StyleSheet.create({
  tool: { flex: 1, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
});

const styles = StyleSheet.create({
  icon: { width: 40, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  tool: toolStyle.tool,
});
