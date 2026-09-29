import type { FriendsList, UserProfile } from '@metacode/shared';
import { describe, expect, it } from 'vitest';
import { friendStatusOf } from './api';

const user = (id: string): UserProfile => ({
  id,
  username: id,
  displayName: null,
  avatarUrl: '',
  character: null,
});

const list: FriendsList = {
  friends: [{ user: user('f'), online: true, since: '' }],
  incoming: [{ user: user('i'), online: false, createdAt: '' }],
  outgoing: [{ user: user('o'), online: false, createdAt: '' }],
};

describe('friendStatusOf', () => {
  it('친구, 받은 요청, 보낸 요청, 관계 없음을 구분한다', () => {
    expect(friendStatusOf(list, 'f')).toBe('friends');
    expect(friendStatusOf(list, 'i')).toBe('incoming');
    expect(friendStatusOf(list, 'o')).toBe('outgoing');
    expect(friendStatusOf(list, 'x')).toBe('none');
    expect(friendStatusOf(undefined, 'f')).toBe('none');
  });
});
