import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';
import { useTheme } from './theme';

/** 버튼 (웹 .button, .button--primary, .button--danger) */
export function Button({
  label,
  onPress,
  variant = 'default',
  disabled,
  busy,
}: {
  label: string;
  onPress(): void;
  variant?: 'default' | 'primary' | 'danger';
  disabled?: boolean;
  busy?: boolean;
}) {
  const theme = useTheme();
  const bg =
    variant === 'primary' ? theme.accent : variant === 'danger' ? theme.danger : theme.bgActive;
  const fg = variant === 'default' ? theme.fg : theme.accentFg;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.label, { color: fg }]}>{label}</Text>
      )}
    </Pressable>
  );
}

/** 이름표가 붙은 입력칸 */
export function TextField({ label, ...props }: TextInputProps & { label?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      {label ? <Text style={[styles.fieldLabel, { color: theme.muted }]}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={theme.muted}
        {...props}
        style={[
          styles.input,
          { color: theme.fg, backgroundColor: theme.bgInput, borderColor: theme.border },
          props.style,
        ]}
      />
    </View>
  );
}

/** 두 개 이상 중 하나 고르기 (웹 .tabs) */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange(value: T): void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: theme.bgInput }]}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[styles.segment, active && { backgroundColor: theme.bgActive }]}
          >
            <Text style={{ color: active ? theme.fg : theme.muted, fontWeight: '600' }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  label: { fontSize: 15, fontWeight: '600' },
  field: { gap: 6 },
  fieldLabel: { fontSize: 12, fontWeight: '700' },
  input: {
    minHeight: 44,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    fontSize: 15,
  },
  segmented: { flexDirection: 'row', borderRadius: 8, padding: 3 },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 6 },
});
