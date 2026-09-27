import { describe, expect, it } from 'vitest';
import { withUserProfile } from './userUpdates';

const alice = { id: 'a', username: 'alice', displayName: null, avatarUrl: 'https://gh/a' };
const bob = { id: 'b', username: 'bob', displayName: null, avatarUrl: 'https://gh/b' };
const renamed = { ...alice, displayName: '앨리스', avatarUrl: 'https://api/avatars/a/1.webp' };

describe('withUserProfile', () => {
  it('중첩된 곳(메시지 작성자, 답장 작성자, 멤버)의 그 사용자만 바꾼다', () => {
    const data = {
      pages: [
        {
          messages: [
            { id: 'm1', author: alice, replyTo: { id: 'm0', author: bob } },
            { id: 'm2', author: bob, replyTo: { id: 'm1', author: alice } },
          ],
        },
      ],
      pageParams: [null],
    };
    const next = withUserProfile(data, renamed);
    expect(next.pages[0]!.messages[0]!.author).toEqual(renamed);
    expect(next.pages[0]!.messages[1]!.replyTo.author).toEqual(renamed);
    // 바뀌지 않은 부분은 같은 객체를 쓴다.
    expect(next.pages[0]!.messages[1]!.author).toBe(bob);
  });

  it('프로필에 붙은 다른 값(자기소개 등)은 남긴다', () => {
    const me = { ...alice, bio: '소개', customAvatar: false };
    expect(withUserProfile(me, renamed)).toEqual({ ...renamed, bio: '소개', customAvatar: false });
  });

  it('바뀐 것이 없으면 같은 객체를 돌려준다', () => {
    const data = { members: [{ user: bob, role: 'MEMBER' }] };
    expect(withUserProfile(data, renamed)).toBe(data);
    const same = { members: [{ user: alice }] };
    expect(withUserProfile(same, alice)).toBe(same);
  });

  it('id가 같아도 사용자 모양이 아니면(메시지 등) 건드리지 않는다', () => {
    const message = { id: 'a', content: '안녕', avatarUrl: undefined };
    expect(withUserProfile(message, renamed)).toBe(message);
  });
});
