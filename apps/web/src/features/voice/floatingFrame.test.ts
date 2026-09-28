import { describe, expect, it } from 'vitest';
import { MIN_SIZE, clampFrame, defaultFrame, resizeFrame } from './floatingFrame';

const view = { width: 1600, height: 900 };

describe('떠 있는 보기 창', () => {
  it('처음에는 화면 가운데에 크게 연다', () => {
    const frame = defaultFrame(view);
    expect(frame.w).toBe(1120);
    expect(frame.x + frame.w / 2).toBeCloseTo(800, 0);
  });

  it('화면 밖으로 나가거나 너무 작아지지 않는다', () => {
    expect(clampFrame({ x: -500, y: -50, w: 100, h: 50 }, view)).toEqual({
      x: 8,
      y: 8,
      w: MIN_SIZE.w,
      h: MIN_SIZE.h,
    });
    const big = clampFrame({ x: 1500, y: 800, w: 5000, h: 5000 }, view);
    expect(big).toEqual({ x: 8, y: 8, w: 1584, h: 884 });
  });

  it('오른쪽 아래를 끌면 크기만, 왼쪽 위를 끌면 반대쪽 모서리는 그대로', () => {
    const start = { x: 100, y: 100, w: 600, h: 400 };
    expect(resizeFrame(start, 'se', 50, 30)).toEqual({ x: 100, y: 100, w: 650, h: 430 });
    expect(resizeFrame(start, 'nw', 50, 30)).toEqual({ x: 150, y: 130, w: 550, h: 370 });
    // 최소 크기에서 멈추면 오른쪽·아래 끝은 움직이지 않는다.
    const small = resizeFrame(start, 'w', 1000, 0);
    expect(small.w).toBe(MIN_SIZE.w);
    expect(small.x + small.w).toBe(700);
  });
});
