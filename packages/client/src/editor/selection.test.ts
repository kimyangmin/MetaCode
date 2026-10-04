import { describe, expect, it } from 'vitest';
import {
  flipWithin,
  copyClip,
  emptyRowsBelow,
  lassoMask,
  maskBounds,
  maskOutline,
  placeClip,
  rectFrom,
  shiftPixels,
  stamp,
} from './selection.js';

const W = 8;

function rows(mask: Uint8Array) {
  return Array.from({ length: mask.length / W }, (_, y) =>
    Array.from(mask.slice(y * W, (y + 1) * W)).join(''),
  );
}

describe('올가미', () => {
  it('다각형 안의 픽셀(가운데 기준)과 선이 지나간 픽셀을 고른다', () => {
    const mask = lassoMask(
      [
        { x: 1, y: 1 },
        { x: 5, y: 1 },
        { x: 5, y: 4 },
        { x: 1, y: 4 },
      ],
      W,
      6,
    );
    expect(rows(mask)).toEqual([
      '00000000',
      '01111100',
      '01111000',
      '01111000',
      '01000100',
      '00000000',
    ]);
  });

  it('그림 밖으로 나간 점은 무시한다', () => {
    const mask = lassoMask(
      [
        { x: -3, y: -3 },
        { x: 20, y: -3 },
        { x: 20, y: 20 },
        { x: -3, y: 20 },
      ],
      W,
      4,
    );
    expect(mask.every((v) => v === 1)).toBe(true);
  });
});

describe('선택 영역', () => {
  it('두 점으로 사각형을 만들고 그림 밖은 잘라 낸다', () => {
    expect(rectFrom({ x: 6, y: 5 }, { x: 2, y: 9 }, W, 8)).toEqual({ x: 2, y: 5, w: 5, h: 3 });
  });

  it('옮기고 얹으면 투명한 칸은 아래가 비친다', () => {
    const base = Uint16Array.from([1, 1, 1, 1]);
    const values = Uint16Array.from([0, 2, 0, 0]);
    const mask = Uint8Array.from([1, 1, 0, 0]);
    expect(Array.from(stamp(base, values, mask))).toEqual([1, 2, 1, 1]);
    expect(Array.from(shiftPixels(Uint8Array.from([1, 2, 3, 4]), 2, 2, 1, 0))).toEqual([
      0, 1, 0, 3,
    ]);
  });

  it('복사한 조각은 같은 자리에 붙고, 작은 그림에서는 넘친 부분을 버린다', () => {
    const pixels = new Uint16Array(W * W);
    const mask = new Uint8Array(W * W);
    pixels[3 * W + 6] = 5;
    mask[3 * W + 6] = 1;
    mask[3 * W + 7] = 1;
    const clip = copyClip(pixels, mask, W)!;
    expect(clip.rect).toEqual({ x: 6, y: 3, w: 2, h: 1 });
    const placed = placeClip(clip, W, W);
    expect(placed.values[3 * W + 6]).toBe(5);
    expect(maskBounds(placed.mask, W)).toEqual(clip.rect);
    const small = placeClip(clip, 7, 7);
    expect(maskBounds(small.mask, 7)).toEqual({ x: 6, y: 3, w: 1, h: 1 });
  });

  it('테두리는 한 칸이면 네 변이다', () => {
    const mask = new Uint8Array(4);
    mask[0] = 1;
    expect(maskOutline(mask, 2, 2)).toHaveLength(4);
  });

  it('맨 아래 빈 줄을 센다', () => {
    const pixels = new Uint16Array(W * 4);
    expect(emptyRowsBelow(pixels, W, 4)).toBe(4);
    pixels[1 * W + 3] = 1;
    expect(emptyRowsBelow(pixels, W, 4)).toBe(2);
  });
});

describe('고른 곳 뒤집기', () => {
  it('감싸는 사각형 안만 좌우·상하로 뒤집고 밖은 그대로 둔다', () => {
    // 3×3: 사각형 (0,0)~(1,1) 안만 뒤집는다
    const pixels = Uint16Array.from([1, 2, 9, 3, 4, 9, 9, 9, 9]);
    const rect = { x: 0, y: 0, w: 2, h: 2 };
    expect(Array.from(flipWithin(pixels, rect, 3, 'x'))).toEqual([2, 1, 9, 4, 3, 9, 9, 9, 9]);
    expect(Array.from(flipWithin(pixels, rect, 3, 'y'))).toEqual([3, 4, 9, 1, 2, 9, 9, 9, 9]);
    const mask = Uint8Array.from([1, 0, 0, 1, 1, 0, 0, 0, 0]);
    expect(Array.from(flipWithin(mask, rect, 3, 'x'))).toEqual([0, 1, 0, 1, 1, 0, 0, 0, 0]);
  });
});
