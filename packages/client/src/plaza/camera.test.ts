import { PlazaMap } from '@metacode/shared';
import { BUILTIN_LAYOUTS } from '@metacode/shared/builtin-assets';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ZOOM, ZOOM_MAX, ZOOM_MIN, stepZoomOffset, zoomFor } from './camera.js';

const square = BUILTIN_LAYOUTS[PlazaMap.FountainSquare];
const campfire = BUILTIN_LAYOUTS[PlazaMap.Campfire];

describe('zoomFor', () => {
  it('모닥불 캠프는 맵 전체가 들어오는 가장 큰 정수 배율', () => {
    // 맵 256×192px
    expect(zoomFor(campfire, 800, 600)).toBe(3);
    expect(zoomFor(campfire, 520, 900)).toBe(2);
    expect(zoomFor(campfire, 200, 150)).toBe(1);
  });

  it('분수 광장은 기본 배율이고, 패널이 좁으면 낮춘다', () => {
    expect(zoomFor(square, 1200, 900)).toBe(DEFAULT_ZOOM);
    expect(zoomFor(square, 400, 700)).toBe(2);
    expect(zoomFor(square, 250, 700)).toBe(1);
  });
});

describe('사용자 배율 (Ctrl +/−)', () => {
  it('기본 배율에서 더하고 빼며, 범위 밖으로 나가지 않는다', () => {
    expect(zoomFor(square, 1200, 900, 1)).toBe(DEFAULT_ZOOM + 1);
    expect(zoomFor(square, 1200, 900, -2)).toBe(DEFAULT_ZOOM - 2);
    expect(zoomFor(square, 1200, 900, 10)).toBe(ZOOM_MAX);
    expect(zoomFor(square, 1200, 900, -10)).toBe(ZOOM_MIN);
  });

  it('범위 끝에서는 더 쌓이지 않아 반대로 한 번 누르면 바로 바뀐다', () => {
    let offset = 0;
    for (let i = 0; i < 10; i++) offset = stepZoomOffset(square, 1200, 900, offset, 1);
    expect(zoomFor(square, 1200, 900, offset)).toBe(ZOOM_MAX);
    offset = stepZoomOffset(square, 1200, 900, offset, -1);
    expect(zoomFor(square, 1200, 900, offset)).toBe(ZOOM_MAX - 1);
  });
});
