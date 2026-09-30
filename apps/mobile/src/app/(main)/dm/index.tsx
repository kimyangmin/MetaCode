import { StyleSheet, Text, View } from 'react-native';
import { ScreenHeader } from '@/layout/ScreenHeader';
import { useOtherUnread } from '@/layout/useOtherUnread';
import { useTheme } from '@/ui/theme';

/** DM 홈: 친구 화면 (친구 목록·요청은 뒤 단계에서 만든다) */
export default function DmHome() {
  const theme = useTheme();
  const otherUnread = useOtherUnread(null);
  return (
    <View style={[styles.root, { backgroundColor: theme.bg }]}>
      <ScreenHeader title="친구" otherUnread={otherUnread} showMembers={false} />
      <View style={styles.body}>
        <Text style={{ color: theme.muted }}>왼쪽 목록에서 대화를 골라 주세요.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});
