import type { RoleDto } from '@metacode/shared';
import { describe, expect, it } from 'vitest';
import { memberColor, roleNames } from './roles';

const roles: RoleDto[] = [
  { id: 'b', name: '개발', color: '#3f8fdb', position: 1 },
  { id: 'a', name: '운영', color: null, position: 0 },
  { id: 'c', name: '디자인', color: '#e5534b', position: 2 },
];

describe('역할 표시', () => {
  it('이름 색은 가진 역할 중 가장 위의, 색이 있는 역할을 따른다', () => {
    expect(memberColor(['c', 'b', 'a'], roles)).toBe('#3f8fdb');
    expect(memberColor(['a'], roles)).toBeNull();
    expect(memberColor([], roles)).toBeNull();
  });

  it('역할 이름은 목록 순서대로', () => {
    expect(roleNames(['c', 'a'], roles)).toEqual(['운영', '디자인']);
  });
});
