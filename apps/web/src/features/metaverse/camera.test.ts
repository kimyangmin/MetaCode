import { MAP_LAYOUTS, PlazaMap } from '@metacode/shared';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ZOOM, zoomFor } from './camera';

const square = MAP_LAYOUTS[PlazaMap.FountainSquare];
const campfire = MAP_LAYOUTS[PlazaMap.Campfire];

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
