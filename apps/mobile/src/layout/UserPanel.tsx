import { displayName } from '@metacode/client';
import type { UserProfile } from '@metacode/shared';
import { router, usePathname } from 'expo-router';
import { Settings } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type RealtimeStatus, useRealtime } from '../realtime/RealtimeProvider';
import { useUiStore } from '../stores/ui';
import { Avatar } from '../ui/Avatar';
import { useTheme } from '../ui/theme';

const STATUS_LABEL: Record<RealtimeStatus, string> = {
  connected: '온라인',
  connecting: '연결 중',
  disconnected: '오프라인',
};

/**
 * 목록 아래: 내 프로필과 연결 상태 (웹 UserPanel).
 * 오른쪽 톱니바퀴로 설정을 연다 (로그아웃은 설정 안에).
 */
export function UserPanel({ me }: { me: UserProfile }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { status } = useRealtime();
  const statusColor =
    status === 'connected' ? theme.ok : status === 'connecting' ? theme.warn : theme.muted;

  const pathname = usePathname();
  const openSettings = () => {
    useUiStore.setState({ settingsReturn: pathname, navOpen: false });
    router.replace('/settings');
  };

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: theme.bgRail,
          paddingBottom: 10 + insets.bottom,
          borderTopColor: theme.border,
        },
      ]}
    >
      <Avatar user={me} size={36} />
      <View style={styles.names}>
        <Text style={[styles.name, { color: theme.fg }]} numberOfLines={1}>
          {displayName(me)}
        </Text>
        <Text style={{ color: statusColor, fontSize: 12 }}>{STATUS_LABEL[status]}</Text>
      </View>
      <Pressable
        onPress={openSettings}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="설정"
        style={styles.button}
      >
        <Settings color={theme.muted} size={20} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  names: { flex: 1, minWidth: 0 },
  name: { fontSize: 14, fontWeight: '600' },
  button: { padding: 6 },
});
