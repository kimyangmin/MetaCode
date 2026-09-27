import type { UserProfile, VoiceMember } from '@metacode/shared';
import { describe, expect, it } from 'vitest';
import { callsFromList, volumeFor, withMember, withProximity, withoutMember } from './calls';

const user = (id: string): UserProfile => ({
  id,
  username: id,
  displayName: null,
  avatarUrl: `https://example.com/${id}.png`,
});
const member = (id: string, patch: Partial<VoiceMember> = {}): VoiceMember => ({
  user: user(id),
  muted: false,
  deafened: false,
  speaking: false,
  ...patch,
});

describe('통화 목록', () => {
  it('참여자가 들어오면 통화가 생기고, 같은 사람은 상태만 바뀐다', () => {
    let calls = withMember({}, 'c1', member('a'));
    calls = withMember(calls, 'c1', member('b'));
    calls = withMember(calls, 'c1', member('a', { speaking: true }));
    expect(calls.c1!.members.map((m) => [m.user.id, m.speaking])).toEqual([
      ['a', true],
      ['b', false],
    ]);
  });

  it('마지막 사람이 나가면 통화가 사라진다', () => {
    let calls = callsFromList([{ channelId: 'c1', proximity: true, members: [member('a')] }]);
    calls = withoutMember(calls, 'c1', 'a');
    expect(calls).toEqual({});
    expect(withoutMember(calls, 'nope', 'a')).toBe(calls);
  });

  it('근접 음성 설정을 바꾼다 (없는 통화는 그대로)', () => {
    const calls = callsFromList([{ channelId: 'c1', proximity: false, members: [member('a')] }]);
    expect(withProximity(calls, 'c1', true).c1!.proximity).toBe(true);
    expect(withProximity(calls, 'c2', true)).toBe(calls);
  });
});

describe('volumeFor', () => {
  const base = { deafened: false, proximity: false, gains: {} };

  it('근접 음성이 꺼져 있으면 모두 원래 크기', () => {
    expect(volumeFor('a', base)).toBe(1);
  });

  it('헤드셋을 끄면 아무도 들리지 않는다', () => {
    expect(volumeFor('a', { ...base, deafened: true })).toBe(0);
  });

  it('근접 음성이 켜져 있으면 받은 음량을 따르고, 모르는 사람은 들리지 않는다', () => {
    const state = { ...base, proximity: true, gains: { a: 0.4 } };
    expect(volumeFor('a', state)).toBe(0.4);
    expect(volumeFor('b', state)).toBe(0);
  });
});
