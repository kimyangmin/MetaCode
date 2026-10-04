import { StyleSheet, View } from 'react-native';
import { FriendsScreen } from '@/features/friends/FriendsScreen';
import { ScreenHeader } from '@/layout/ScreenHeader';
import { useOtherUnread } from '@/layout/useOtherUnread';
import { useTheme } from '@/ui/theme';

/** DM 홈: 친구 화면 (온라인 · 모두 · 대기 중 · 추가) */
export default function DmHome() {
  const theme = useTheme();
  const otherUnread = useOtherUnread(null);
  return (
    <View style={[styles.root, { backgroundColor: theme.bg }]}>
      <ScreenHeader title="친구" otherUnread={otherUnread} showMembers={false} />
      <FriendsScreen />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
