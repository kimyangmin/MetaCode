import { PALETTE_MAX_COLORS } from '@metacode/shared';
import { describe, expect, it } from 'vitest';
import {
  decodeGif,
  detectPixelScale,
  encodeGif,
  expandByDelays,
  frameMsOf,
  mirrorPixels,
  oppositeAnimation,
  placePixels,
  shrinkRgba,
} from './gif';
import { quantizeFrames } from './png';

const palette = ['#ff0000', '#00ff00'];
/** 2×2: 빨강, 투명 / 초록, 빨강 */
const frameA = Uint16Array.from([1, 0, 2, 1]);
const frameB = Uint16Array.from([0, 2, 2, 0]);

describe('GIF', () => {
  it('내보낸 GIF를 다시 풀면 같은 그림이고, 투명한 곳이 앞 장면을 남기지 않는다', () => {
    const bytes = encodeGif([frameA, frameB], 2, 2, palette, 120, 3);
    const gif = decodeGif(bytes);
    expect([gif.width, gif.height, gif.frames.length]).toEqual([6, 6, 2]);
    expect(gif.delays).toEqual([120, 120]);
    expect(detectPixelScale(gif)).toBe(3);
    const small = gif.frames.map((f) => shrinkRgba(f, 6, 6, 3));
    const { frames, palette: next } = quantizeFrames(small, 2, 2, palette);
    expect(next).toEqual(palette);
    expect(frames).toEqual([frameA, frameB]);
  });

  it('색이 많으면 남은 팔레트 자리만큼 줄이고, 원래 색은 그대로 쓴다', () => {
    const rgba = new Uint8ClampedArray(100 * 4);
    for (let i = 0; i < 100; i++) rgba.set([i * 2, 255 - i * 2, 7, 255], i * 4);
    // 남은 자리 4칸
    const base = Array.from(
      { length: PALETTE_MAX_COLORS - 4 },
      (_, i) => `#${(i + 0x100000).toString(16).padStart(6, '0')}`,
    );
    const { frames, palette: next } = quantizeFrames([rgba], 10, 10, base);
    expect(next).toHaveLength(PALETTE_MAX_COLORS);
    expect(next.slice(0, base.length)).toEqual(base);
    expect(frames[0]!.every((v) => v >= 1 && v <= PALETTE_MAX_COLORS)).toBe(true);
  });

  it('팔레트가 가득 차 있으면 새 색을 더하지 않는다 (예전엔 한 색이 늘어 저장이 막혔다)', () => {
    const rgba = Uint8ClampedArray.from([1, 2, 3, 255]);
    const full = Array.from(
      { length: PALETTE_MAX_COLORS },
      (_, i) => `#${(i + 0x100000).toString(16).padStart(6, '0')}`,
    );
    expect(quantizeFrames([rgba], 1, 1, full).palette).toHaveLength(PALETTE_MAX_COLORS);
  });

  it('255색이 넘어도 색을 줄이지 않고 모두 팔레트에 더한다', () => {
    const rgba = new Uint8ClampedArray(600 * 4);
    for (let i = 0; i < 600; i++) rgba.set([i & 0xff, i >> 8, 9, 255], i * 4);
    const { frames, palette: next } = quantizeFrames([rgba], 600, 1, []);
    expect(next).toHaveLength(600);
    expect(frames[0]![599]).toBe(600);
  });

  it('팔레트가 255색을 넘으면 장면마다 팔레트를 따로 만들어 GIF로 내보낸다', () => {
    const many = Array.from({ length: 300 }, (_, i) => `#${(i * 4).toString(16).padStart(6, '0')}`);
    const frame = Uint16Array.from([1, 300, 0, 150]);
    const gif = decodeGif(encodeGif([frame], 2, 2, many, 100));
    const px = (i: number) => Array.from(gif.frames[0]!.slice(i * 4, i * 4 + 4));
    expect(px(0)).toEqual([0, 0, 0, 255]);
    expect(px(1)).toEqual([0, (299 * 4) >> 8, (299 * 4) & 0xff, 255]);
    expect(px(2)[3]).toBe(0);
    expect(px(3)).toEqual([0, (149 * 4) >> 8, (149 * 4) & 0xff, 255]);
  });

  it('장면 시간은 가운데 값을 10ms 단위로, 범위 안에서', () => {
    expect(frameMsOf([100, 100, 500], 40, 2000)).toBe(100);
    expect(frameMsOf([10], 40, 2000)).toBe(40);
  });

  it('놓기와 좌우 반전, 반대 방향 이름', () => {
    expect(placePixels(Uint16Array.from([5]), 1, 1, 3, 2, 'bottom-center')).toEqual(
      Uint16Array.from([0, 0, 0, 0, 5, 0]),
    );
    expect(mirrorPixels(Uint16Array.from([1, 2, 3, 4]), 2, 2)).toEqual(
      Uint16Array.from([2, 1, 4, 3]),
    );
    expect(oppositeAnimation('walk-left')).toBe('walk-right');
    expect(oppositeAnimation('jump-right')).toBe('jump-left');
    expect(oppositeAnimation('emote')).toBeNull();
  });
});

describe('장면마다 다른 시간', () => {
  it('프레임 간격의 배수만큼 같은 장면을 되풀이하고, 너무 길면 8번까지만', () => {
    expect(expandByDelays(['a', 'b', 'c'], [100, 200, 100], 100)).toEqual(['a', 'b', 'b', 'c']);
    expect(expandByDelays(['a'], [5000], 100)).toHaveLength(8);
    expect(expandByDelays(['a', 'b'], [10, 10], 100)).toEqual(['a', 'b']);
  });
});
