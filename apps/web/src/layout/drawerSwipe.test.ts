import { describe, expect, it } from 'vitest';
import { dragOffset, openDragOffset, shouldClose, shouldOpen } from './drawerSwipe';

describe('서랍 밀어 여닫기', () => {
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

  it('닫힌 목록 서랍은 오른쪽으로 미는 만큼 나오고, 서랍 폭보다 더 나오지 않는다', () => {
    expect(openDragOffset(0, 300)).toBe(-300);
    expect(openDragOffset(100, 300)).toBe(-200);
    expect(openDragOffset(400, 300)).toBe(0);
    expect(openDragOffset(-50, 300)).toBe(-300);

    expect(shouldOpen(80)).toBe(true);
    expect(shouldOpen(30)).toBe(false);
    expect(shouldOpen(-80)).toBe(false);
  });
});
