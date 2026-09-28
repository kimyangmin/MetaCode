import sharp from 'sharp';
import { Canvas, toManifest } from './canvas.mjs';

/** Kenney Tiny Town (CC0): 12×11칸, 16×16 타일 */
const COLUMNS = 12;
const ROWS = 11;
const T = 16;

const NAMES = {
  0: '잔디',
  1: '잔디 (풀)',
  2: '잔디 (꽃)',
  3: '나무 (노란 뾰족)',
  4: '나무 (뾰족)',
  5: '덤불',
  12: '흙 (왼쪽 위)',
  13: '흙 (위)',
  14: '흙 (오른쪽 위)',
  15: '나무 (노란 둥근)',
  16: '나무 (둥근)',
  17: '새싹',
  24: '흙 (왼쪽)',
  25: '흙',
  26: '흙 (오른쪽)',
  27: '나무 (노란 작은)',
  28: '나무 (작은)',
  29: '버섯',
  36: '흙 (왼쪽 아래)',
  37: '흙 (아래)',
  38: '흙 (오른쪽 아래)',
  39: '흙 (안쪽 왼쪽 위)',
  40: '흙 (안쪽 오른쪽 위)',
  41: '흙 (안쪽 왼쪽 아래)',
  42: '흙 (안쪽 오른쪽 아래)',
  43: '돌길',
  57: '게시판',
  83: '표지판',
  94: '벌통',
  95: '과녁',
  104: '우물',
};

/** 지나갈 수 없는 칸: 나무·숲, 울타리, 건물, 성벽, 우물 같은 큰 소품 */
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
// prettier-ignore
const SOLID = new Set([
  3, 4, 5, 15, 16, 27, 28,
  ...range(6, 11), ...range(18, 23), ...range(30, 35),
  ...range(44, 47), ...range(56, 59), ...range(68, 71), ...range(80, 82),
  ...range(48, 55), ...range(60, 67), ...range(72, 79), ...range(84, 92),
  94, 95, 96, 98, ...range(99, 104), 108, 110, ...range(111, 114), 120, ...range(122, 126),
]);

export async function kenneyTiles(file) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const assets = {};
  for (let index = 0; index < COLUMNS * ROWS; index++) {
    const canvas = new Canvas(T, T);
    const ox = (index % COLUMNS) * T;
    const oy = Math.floor(index / COLUMNS) * T;
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const i = ((oy + y) * info.width + ox + x) * 4;
        if (data[i + 3] < 128) continue;
        canvas.set(
          x,
          y,
          `#${[data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`,
        );
      }
    }
    if (canvas.px.every((c) => c === null)) continue;
    assets[`builtin:tt-${index}`] = toManifest({
      kind: 'tile',
      name: NAMES[index] ?? `타일 ${index}`,
      frames: [canvas],
      animations: { default: { frames: [0], frameMs: 1000 } },
      solid: SOLID.has(index),
    });
  }
  return assets;
}
