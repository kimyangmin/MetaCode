import type { UserProfile } from '@metacode/shared';
import { describe, expect, it } from 'vitest';
import { insertMention, mentionAt, mentionCandidates } from './mentions.js';

const user = (id: string, username: string, displayName: string | null = null): UserProfile => ({
  id,
  username,
  displayName,
  avatarUrl: '',
  character: null,
});

describe('멘션 고르기', () => {
  const me = user('me', 'Alice');
  const people = [me, user('b', 'dev-bob', '밥'), user('c', 'carol', '캐롤'), user('d', 'bobby')];

  it('아이디가 그 글자로 시작하거나 닉네임에 있으면 고르고, 나는 빼며, 아이디로 맞는 사람이 먼저', () => {
    expect(mentionCandidates(people, 'bo', me.id).map((p) => p.username)).toEqual(['bobby']);
    expect(mentionCandidates(people, '밥', me.id).map((p) => p.username)).toEqual(['dev-bob']);
    expect(mentionCandidates(people, '', me.id)).toHaveLength(3);
  });

  it('커서 바로 앞의 @글자만 쓰는 중인 멘션으로 본다', () => {
    expect(mentionAt('안녕 @bo', 6)).toEqual({ start: 3, query: 'bo' });
    expect(mentionAt('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionAt('mail@bo', 7)).toBeNull();
    expect(mentionAt('@bo 다음', 7)).toBeNull();
  });

  it('고른 사람으로 @글자를 바꾸고 커서를 띄어쓰기 뒤에 둔다', () => {
    expect(insertMention('안녕 @bo 잘 가', { start: 3, query: 'bo' }, 'bobby')).toEqual({
      text: '안녕 @bobby  잘 가',
      caret: 10,
    });
  });
});
