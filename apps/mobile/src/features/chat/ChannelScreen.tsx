import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ScreenHeader } from '../../layout/ScreenHeader';
import { useOtherUnread } from '../../layout/useOtherUnread';
import { useTheme } from '../../ui/theme';

/**
 * 채널 화면(텍스트 채널, DM): 머리글 + 채팅·광장.
 * 채팅과 광장은 다음 단계에서 넣는다.
 */
export function ChannelScreen({
  channelId,
  icon,
  title,
  showMembers,
}: {
  channelId: string;
  icon?: ReactNode;
  title: string;
  showMembers: boolean;
}) {
  const theme = useTheme();
  const otherUnread = useOtherUnread(channelId);
  return (
    <View style={[styles.root, { backgroundColor: theme.bg }]}>
      <ScreenHeader icon={icon} title={title} otherUnread={otherUnread} showMembers={showMembers} />
      <View style={styles.body}>
        <Text style={{ color: theme.muted }}>채팅과 광장은 다음 단계에서 들어옵니다.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});
