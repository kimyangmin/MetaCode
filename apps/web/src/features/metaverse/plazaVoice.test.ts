import type { VoiceCall } from '@metacode/shared';
import { describe, expect, it } from 'vitest';
import { plazaVoiceStates } from './plazaVoice';

const call = (channelId: string, userId: string, speaking = false, sharing = false): VoiceCall => ({
  channelId,
  proximity: false,
  members: [
    {
      user: { id: userId, username: userId, displayName: null, avatarUrl: '', character: null },
      muted: false,
      deafened: false,
      speaking,
      sharing,
    },
  ],
});

describe('plazaVoiceStates', () => {
  it('이 광장의 통화 참여자에게 채널 이름과 말하는 중을 붙인다', () => {
    const calls = { lounge: call('lounge', 'a', true), other: call('other', 'b') };
    const states = plazaVoiceStates(calls, new Map([['lounge', '🔊 lounge']]));
    expect([...states]).toEqual([['a', { label: '🔊 lounge', speaking: true, muted: false }]]);
  });

  it('화면을 공유 중이면 이름표에 표시한다', () => {
    const states = plazaVoiceStates(
      { lounge: call('lounge', 'a', false, true) },
      new Map([['lounge', '🔊 lounge']]),
    );
    expect(states.get('a')?.label).toBe('🔊 lounge 🖥️');
  });
});
