import type { VoiceCall } from '@metacode/shared';
import type { ActorVoice } from './PlazaScene';

/**
 * 광장 캐릭터에 보일 통화 상태. 이 광장에 속한 통화(분수 광장은 커뮤니티의 음성 채널들,
 * 모닥불 캠프는 그 DM)의 참여자만 표시하고, 표시할 이름은 channelLabels에서 가져온다.
 * 참여 중인 채널 이름은 모두에게 보이지만, 말하는 중은 내가 들어가 있는 통화(myCallId)의 사람만 보인다.
 */
export function plazaVoiceStates(
  calls: Record<string, VoiceCall>,
  channelLabels: ReadonlyMap<string, string>,
  myCallId: string | null,
): Map<string, ActorVoice> {
  const states = new Map<string, ActorVoice>();
  for (const [channelId, label] of channelLabels) {
    for (const member of calls[channelId]?.members ?? []) {
      states.set(member.user.id, {
        // 화면을 공유 중이면 광장에서도 알 수 있게 표시한다.
        label: member.sharing ? `${label} 🖥️` : label,
        speaking: channelId === myCallId && member.speaking,
        muted: member.muted,
      });
    }
  }
  return states;
}
