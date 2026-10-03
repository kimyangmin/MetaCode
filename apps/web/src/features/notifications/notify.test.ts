import type { UserProfile } from '@metacode/shared';
import { describe, expect, it } from 'vitest';
import { mentionCandidates } from '../chat/Composer';
import { mentionsMe, shouldNotify } from './notify';

const user = (id: string, username: string, displayName: string | null = null): UserProfile => ({
  id,
  username,
  displayName,
  avatarUrl: '',
  character: null,
});

const me = user('me', 'Alice');
const bob = user('b', 'dev-bob', '밥');
const message = (content: string, replyToAuthor?: UserProfile) => ({
  author: bob,
  channelId: 'c1',
  content,
  replyTo: replyToAuthor
    ? { id: 'r', author: replyToAuthor, content: '', attachmentCount: 0 }
    : null,
});

describe('나를 부른 메시지', () => {
  it('@내아이디(대소문자 상관없이)나 내 메시지에 단 답장이면 부른 것이다', () => {
    expect(mentionsMe(message('@alice 안녕'), me)).toBe(true);
    expect(mentionsMe(message('그냥 alice'), me)).toBe(false);
    expect(mentionsMe(message('`@alice`'), me)).toBe(false);
    expect(mentionsMe(message('답장', me), me)).toBe(true);
    expect(mentionsMe({ ...message('@alice'), author: me }, me)).toBe(false);
  });
});

describe('알릴지', () => {
  const base = { me, isDm: false, viewing: false };
  it('기본(DM과 멘션)은 DM과 나를 부른 메시지만, 모든 메시지는 다, 받지 않음은 하나도', () => {
    expect(shouldNotify({ ...base, level: 'mentions', message: message('안녕') })).toBe(false);
    expect(shouldNotify({ ...base, level: 'mentions', message: message('@Alice') })).toBe(true);
    expect(shouldNotify({ ...base, level: 'mentions', isDm: true, message: message('안녕') })).toBe(
      true,
    );
    expect(shouldNotify({ ...base, level: 'all', message: message('안녕') })).toBe(true);
    expect(shouldNotify({ ...base, level: 'off', message: message('@Alice') })).toBe(false);
  });

  it('보고 있는 채널이나 내가 보낸 메시지는 알리지 않는다', () => {
    expect(shouldNotify({ ...base, level: 'all', viewing: true, message: message('@Alice') })).toBe(
      false,
    );
    expect(
      shouldNotify({ ...base, level: 'all', message: { ...message('안녕'), author: me } }),
    ).toBe(false);
  });
});

describe('멘션 고르기', () => {
  const people = [me, bob, user('c', 'carol', '캐롤'), user('d', 'bobby')];
  it('아이디가 그 글자로 시작하거나 닉네임에 있으면 고르고, 나는 빼며, 아이디로 맞는 사람이 먼저', () => {
    expect(mentionCandidates(people, 'bo', me.id).map((p) => p.username)).toEqual(['bobby']);
    expect(mentionCandidates(people, '밥', me.id).map((p) => p.username)).toEqual(['dev-bob']);
    expect(mentionCandidates(people, '', me.id)).toHaveLength(3);
  });
});
