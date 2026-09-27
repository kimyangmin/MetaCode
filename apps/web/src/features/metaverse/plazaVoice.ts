import type { VoiceCall } from '@metacode/shared';
import type { ActorVoice } from './PlazaScene';

/**
 * 광장 캐릭터에 보일 통화 상태. 이 광장에 속한 통화(분수 광장은 커뮤니티의 음성 채널들,
 * 모닥불 캠프는 그 DM)의 참여자만 표시하고, 표시할 이름은 channelLabels에서 가져온다.
 */
export function plazaVoiceStates(
  calls: Record<string, VoiceCall>,
  channelLabels: ReadonlyMap<string, string>,
): Map<string, ActorVoice> {
  const states = new Map<string, ActorVoice>();
  for (const [channelId, label] of channelLabels) {
    for (const member of calls[channelId]?.members ?? []) {
      states.set(member.user.id, { label, speaking: member.speaking, muted: member.muted });
    }
  }
  return states;
}
