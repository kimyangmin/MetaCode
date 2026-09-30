import { Redirect, useLocalSearchParams } from 'expo-router';
import { Hash } from 'lucide-react-native';
import { useCommunities } from '@/api/queries';
import { ChannelScreen } from '@/features/chat/ChannelScreen';
import { useTheme } from '@/ui/theme';

/** 커뮤니티의 텍스트 채널 */
export default function CommunityChannel() {
  const theme = useTheme();
  const { communityId, channelId } = useLocalSearchParams<{
    communityId: string;
    channelId: string;
  }>();
  const communities = useCommunities();
  if (!communities.data) return null;
  const community = communities.data.find((c) => c.id === communityId);
  if (!community) return <Redirect href="/" />;
  const channel = community.channels.find((c) => c.id === channelId && c.type === 'TEXT');
  // 지워졌거나 볼 수 없게 된 채널이면 커뮤니티의 첫 채널로
  if (!channel) return <Redirect href={`/c/${community.id}`} />;

  return (
    <ChannelScreen
      key={channel.id}
      channelId={channel.id}
      icon={<Hash color={theme.muted} size={20} />}
      title={channel.name ?? ''}
      showMembers
    />
  );
}
