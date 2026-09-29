import { describe, expect, it } from 'vitest';
import { INITIAL_VIEW, clampView, cropOf, imagePlacement, panView, zoomView } from './imageCrop';

const wide = { width: 600, height: 300 };
const square = { width: 200, height: 200 };

describe('사진 위치 조정', () => {
  it('처음에는 가운데를 틀에 꽉 차게 자른다', () => {
    expect(cropOf(INITIAL_VIEW, wide, square)).toEqual({ x: 0.25, y: 0, width: 0.5, height: 1 });
    // 틀 크기와 상관없이 같은 곳이다.
    expect(cropOf(INITIAL_VIEW, wide, { width: 320, height: 320 })).toEqual({
      x: 0.25,
      y: 0,
      width: 0.5,
      height: 1,
    });
  });

  it('사진을 끌면 틀은 반대쪽을 보고, 사진 밖으로는 나가지 않는다', () => {
    // 배율: 틀 높이 200 / 사진 높이 300 → 사진 너비는 화면에서 400px
    const right = panView(INITIAL_VIEW, wide, square, -100, 0);
    expect(cropOf(right, wide, square)).toEqual({ x: 0.5, y: 0, width: 0.5, height: 1 });
    const beyond = panView(right, wide, square, -1000, 0);
    expect(cropOf(beyond, wide, square).x).toBeCloseTo(0.5);
    // 세로는 이미 꽉 차 있어 움직이지 않는다.
    expect(cropOf(panView(INITIAL_VIEW, wide, square, 0, 50), wide, square).y).toBe(0);
  });

  it('확대하면 틀이 덮는 곳이 작아지고, 1~5배로 제한한다', () => {
    const zoomed = zoomView(INITIAL_VIEW, wide, square, 2);
    expect(cropOf(zoomed, wide, square)).toEqual({
      x: 0.375,
      y: 0.25,
      width: 0.25,
      height: 0.5,
    });
    expect(clampView({ ...INITIAL_VIEW, zoom: 0.2 }, wide, square).zoom).toBe(1);
    expect(clampView({ ...INITIAL_VIEW, zoom: 99 }, wide, square).zoom).toBe(5);
  });

  it('구석까지 옮긴 뒤 축소하면 틀이 사진 안으로 돌아온다', () => {
    const corner = panView(zoomView(INITIAL_VIEW, wide, square, 3), wide, square, 5000, 5000);
    const back = zoomView(corner, wide, square, 1);
    const crop = cropOf(back, wide, square);
    expect(crop.x).toBeGreaterThanOrEqual(0);
    expect(crop.y).toBeGreaterThanOrEqual(0);
    expect(crop.x + crop.width).toBeLessThanOrEqual(1);
  });

  it('그릴 위치: 틀 가운데에 고른 점이 온다', () => {
    const place = imagePlacement(INITIAL_VIEW, wide, square);
    expect(place).toEqual({ left: -100, top: 0, width: 400, height: 200 });
  });
});
