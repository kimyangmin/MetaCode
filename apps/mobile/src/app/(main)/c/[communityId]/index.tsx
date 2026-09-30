import { Redirect, useLocalSearchParams } from 'expo-router';
import { useCommunities } from '@/api/queries';

/** 커뮤니티를 고르면 첫 텍스트 채널로 (웹 CommunityPage와 같음). 나갔거나 없는 커뮤니티면 처음으로 */
export default function CommunityIndex() {
  const { communityId } = useLocalSearchParams<{ communityId: string }>();
  const communities = useCommunities();
  if (!communities.data) return null;
  const community = communities.data.find((c) => c.id === communityId);
  const channel = community?.channels.find((c) => c.type === 'TEXT');
  if (!community || !channel) return <Redirect href="/" />;
  return <Redirect href={`/c/${community.id}/${channel.id}`} />;
}
