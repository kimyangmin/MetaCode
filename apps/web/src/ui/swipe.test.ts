import { describe, expect, it } from 'vitest';
import { gestureAxis } from './swipe';

describe('밀기 방향', () => {
  it('처음 움직인 방향으로 가로 밀기와 세로 스크롤을 가른다', () => {
    expect(gestureAxis(3, 4)).toBeNull();
    expect(gestureAxis(-20, 5)).toBe('x');
    expect(gestureAxis(5, 20)).toBe('y');
  });
});
