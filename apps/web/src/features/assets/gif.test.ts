import { describe, expect, it } from 'vitest';
import {
  decodeGif,
  detectPixelScale,
  encodeGif,
  frameMsOf,
  mirrorPixels,
  oppositeAnimation,
  placePixels,
  shrinkRgba,
} from './gif';
import { quantizeFrames } from './png';

const palette = ['#ff0000', '#00ff00'];
/** 2×2: 빨강, 투명 / 초록, 빨강 */
const frameA = Uint8Array.from([1, 0, 2, 1]);
const frameB = Uint8Array.from([0, 2, 2, 0]);

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
    const base = Array.from({ length: 60 }, (_, i) => `#0000${i.toString(16).padStart(2, '0')}`);
    const { frames, palette: next } = quantizeFrames([rgba], 10, 10, base);
    expect(next).toHaveLength(64);
    expect(next.slice(0, 60)).toEqual(base);
    expect(frames[0]!.every((v) => v >= 1 && v <= 64)).toBe(true);
  });

  it('장면 시간은 가운데 값을 10ms 단위로, 범위 안에서', () => {
    expect(frameMsOf([100, 100, 500], 40, 2000)).toBe(100);
    expect(frameMsOf([10], 40, 2000)).toBe(40);
  });

  it('놓기와 좌우 반전, 반대 방향 이름', () => {
    expect(placePixels(Uint8Array.from([5]), 1, 1, 3, 2, 'bottom-center')).toEqual(
      Uint8Array.from([0, 0, 0, 0, 5, 0]),
    );
    expect(mirrorPixels(Uint8Array.from([1, 2, 3, 4]), 2, 2)).toEqual(
      Uint8Array.from([2, 1, 4, 3]),
    );
    expect(oppositeAnimation('walk-left')).toBe('walk-right');
    expect(oppositeAnimation('jump-right')).toBe('jump-left');
    expect(oppositeAnimation('emote')).toBeNull();
  });
});
