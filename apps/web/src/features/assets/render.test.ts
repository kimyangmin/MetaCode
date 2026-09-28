import { describe, expect, it } from 'vitest';
import { SHEET_MAX_SIZE, frameAt, frameOnce, isAnimated, sheetColumns } from './render';

const walk = { frames: [4, 5, 6], frameMs: 100 };

describe('애니메이션 프레임', () => {
  it('frameAt은 frameMs마다 다음 프레임으로 가고 되풀이한다', () => {
    expect(frameAt(walk, 0)).toBe(4);
    expect(frameAt(walk, 99)).toBe(4);
    expect(frameAt(walk, 100)).toBe(5);
    expect(frameAt(walk, 250)).toBe(6);
    expect(frameAt(walk, 300)).toBe(4);
    expect(frameAt(walk, -50)).toBe(4);
  });

  it('frameOnce는 끝나면 마지막 프레임에 머문다', () => {
    expect(frameOnce(walk, 150)).toBe(5);
    expect(frameOnce(walk, 10_000)).toBe(6);
  });

  it('프레임이 하나뿐이거나 같은 프레임만 있으면 움직이지 않는 것', () => {
    expect(isAnimated(walk)).toBe(true);
    expect(isAnimated({ frames: [2, 2], frameMs: 100 })).toBe(false);
    expect(isAnimated(undefined)).toBe(false);
  });
});

describe('프레임 시트', () => {
  const sheet = (width: number, count: number) => ({
    width,
    frames: Array<string>(count).fill(''),
  });

  it('작은 에셋은 한 줄에 다 넣는다', () => {
    expect(sheetColumns(sheet(16, 30))).toBe(30);
  });

  it('한 줄이 텍스처 한계를 넘으면 줄을 나눈다', () => {
    // 128px짜리 프레임은 한 줄에 32장까지다 (4096 / 128).
    expect(sheetColumns(sheet(128, 40))).toBe(SHEET_MAX_SIZE / 128);
    expect(sheetColumns(sheet(128, 40)) * 128).toBeLessThanOrEqual(SHEET_MAX_SIZE);
  });
});
