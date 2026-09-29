import { describe, expect, it } from 'vitest';
import { dragOffset, gestureAxis, shouldClose } from './drawerSwipe';

describe('서랍 밀어 닫기', () => {
  it('왼쪽 목록은 왼쪽으로, 멤버 목록은 오른쪽으로 밀어야 따라오고 닫힌다', () => {
    expect(dragOffset('nav', -40)).toBe(-40);
    expect(dragOffset('nav', 40)).toBe(0);
    expect(dragOffset('members', 40)).toBe(40);
    expect(dragOffset('members', -40)).toBe(0);

    expect(shouldClose('nav', -80)).toBe(true);
    expect(shouldClose('nav', -30)).toBe(false);
    expect(shouldClose('nav', 200)).toBe(false);
    expect(shouldClose('members', 80)).toBe(true);
    expect(shouldClose('members', -200)).toBe(false);
  });

  it('처음 움직인 방향으로 가로 밀기와 세로 스크롤을 가른다', () => {
    expect(gestureAxis(3, 4)).toBeNull();
    expect(gestureAxis(-20, 5)).toBe('x');
    expect(gestureAxis(5, 20)).toBe('y');
  });
});
