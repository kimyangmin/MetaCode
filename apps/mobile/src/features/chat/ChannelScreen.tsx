import type { ChannelSummary, UserProfile } from '@metacode/shared';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useMe } from '../../api/queries';
import { ScreenHeader } from '../../layout/ScreenHeader';
import { useOtherUnread } from '../../layout/useOtherUnread';
import { useTheme } from '../../ui/theme';
import { ChatView } from './ChatView';

/**
 * 채널 화면(텍스트 채널, DM): 머리글 + 채팅. 광장은 다음 단계에서 위에 나눠 넣는다 (웹 휴대폰 화면처럼).
 */
export function ChannelScreen({
  channel,
  icon,
  title,
  inputTitle,
  people,
  showMembers,
  canDeleteOthers,
}: {
  channel: ChannelSummary;
  icon?: ReactNode;
  title: string;
  /** 입력칸 안내에 쓸 이름 (#일반, 상대 이름) */
  inputTitle: string;
  people: UserProfile[];
  showMembers: boolean;
  canDeleteOthers: boolean;
}) {
  const theme = useTheme();
  const me = useMe().data;
  const otherUnread = useOtherUnread(channel.id);
  return (
    <View style={[styles.root, { backgroundColor: theme.bg }]}>
      <ScreenHeader icon={icon} title={title} otherUnread={otherUnread} showMembers={showMembers} />
      {me && (
        <ChatView
          channelId={channel.id}
          title={inputTitle}
          me={me}
          lastReadMessageId={channel.lastReadMessageId}
          people={people}
          canDeleteOthers={canDeleteOthers}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
