import { Menu, Users } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUiStore } from '../stores/ui';
import { useTheme } from '../ui/theme';

/**
 * 화면 머리글 (웹 휴대폰 화면의 머리글): ☰(목록 서랍, 다른 곳에 안 읽은 메시지가 있으면 점), 제목, 멤버 버튼.
 */
export function ScreenHeader({
  icon,
  title,
  otherUnread,
  showMembers,
  actions,
}: {
  icon?: ReactNode;
  title: string;
  /** 지금 보는 곳 밖에 안 읽은 메시지가 있음 */
  otherUnread: boolean;
  showMembers: boolean;
  /** 멤버 버튼 앞에 둘 버튼 (광장 켜고 끄기 등) */
  actions?: ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top, backgroundColor: theme.bg, borderBottomColor: theme.border },
      ]}
    >
      <Pressable
        onPress={() => useUiStore.getState().setNavOpen(true)}
        hitSlop={8}
        style={styles.button}
        accessibilityRole="button"
        accessibilityLabel="목록 열기"
      >
        <Menu color={theme.muted} size={22} />
        {otherUnread && (
          <View style={[styles.dot, { backgroundColor: theme.danger, borderColor: theme.bg }]} />
        )}
      </Pressable>
      <View style={styles.titleRow}>
        {icon}
        <Text style={[styles.title, { color: theme.fg }]} numberOfLines={1}>
          {title}
        </Text>
      </View>
      {actions}
      {showMembers && (
        <Pressable
          onPress={() => useUiStore.getState().setMembersOpen(true)}
          hitSlop={8}
          style={styles.button}
          accessibilityRole="button"
          accessibilityLabel="멤버 목록"
        >
          <Users color={theme.muted} size={22} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  button: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center' },
  dot: {
    position: 'absolute',
    top: 12,
    right: 8,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
  },
  titleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  title: { flexShrink: 1, fontSize: 17, fontWeight: '700' },
});
