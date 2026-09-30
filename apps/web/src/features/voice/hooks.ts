import { dmTitle } from '@metacode/client';
import { useCommunities, useDms } from '../communities/hooks';

export interface ChannelLabel {
  /** 음성 채널 이름 또는 DM 상대 */
  name: string;
  /** 커뮤니티 이름. DM이면 '다이렉트 메시지' */
  place: string;
  kind: 'voice' | 'dm';
}

/** 통화 중인 채널을 사람이 읽을 이름으로 (음성 패널 표시용) */
export function useChannelLabel(channelId: string | undefined, meId: string): ChannelLabel | null {
  const communities = useCommunities();
  const dms = useDms();
  if (!channelId) return null;
  for (const community of communities.data ?? []) {
    const channel = community.channels.find((c) => c.id === channelId);
    if (channel) return { name: channel.name ?? '', place: community.name, kind: 'voice' };
  }
  const dm = dms.data?.find((d) => d.id === channelId);
  if (dm) return { name: dmTitle(dm, meId), place: '다이렉트 메시지', kind: 'dm' };
  return null;
}
