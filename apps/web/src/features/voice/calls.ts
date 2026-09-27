import type { VoiceCall, VoiceMember } from '@metacode/shared';

/** 진행 중인 통화들: channelId → 통화. 서버 이벤트로 고친다 */
export type Calls = Record<string, VoiceCall>;

export function callsFromList(list: VoiceCall[]): Calls {
  return Object.fromEntries(list.map((call) => [call.channelId, call]));
}

/** 참여자를 넣거나 상태를 바꾼다. 모르던 통화면 새로 만든다 */
export function withMember(calls: Calls, channelId: string, member: VoiceMember): Calls {
  const call = calls[channelId] ?? { channelId, proximity: false, members: [] };
  const exists = call.members.some((m) => m.user.id === member.user.id);
  const members = exists
    ? call.members.map((m) => (m.user.id === member.user.id ? member : m))
    : [...call.members, member];
  return { ...calls, [channelId]: { ...call, members } };
}

/** 참여자를 뺀다. 아무도 없으면 통화가 끝난다 */
export function withoutMember(calls: Calls, channelId: string, userId: string): Calls {
  const call = calls[channelId];
  if (!call) return calls;
  const members = call.members.filter((m) => m.user.id !== userId);
  const next = { ...calls };
  if (members.length === 0) delete next[channelId];
  else next[channelId] = { ...call, members };
  return next;
}

export function withProximity(calls: Calls, channelId: string, enabled: boolean): Calls {
  const call = calls[channelId];
  return call ? { ...calls, [channelId]: { ...call, proximity: enabled } } : calls;
}

/**
 * 다른 참여자의 목소리를 얼마나 크게 들을지 (0이면 구독하지 않는다).
 * 헤드셋을 끄면 아무도 들리지 않고, 근접 음성이 꺼져 있으면 모두 원래 크기로 들린다.
 * 근접 음성이 켜져 있으면 서버가 보낸 음량을 따르고, 아직 받지 못한 사람은 들리지 않는다.
 */
export function volumeFor(
  identity: string,
  state: { deafened: boolean; proximity: boolean; gains: Record<string, number> },
): number {
  if (state.deafened) return 0;
  if (!state.proximity) return 1;
  return state.gains[identity] ?? 0;
}
