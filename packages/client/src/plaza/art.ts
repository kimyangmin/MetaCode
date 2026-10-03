/**
 * 광장의 작은 표시: 그림자, 클릭 표시, 말하는 중 고리, 횡스크롤 하늘의 구름·언덕.
 * 픽셀 단위 RGBA로 만들고, 그리는 쪽(웹 Phaser 텍스처, 네이티브 Skia 이미지)이 이것을 올려 쓴다.
 */

export interface PixelArt {
  width: number;
  height: number;
  /** RGBA, 한 줄씩 */
  data: Uint8ClampedArray<ArrayBuffer>;
}

type Rgba = readonly [number, number, number, number];

function art(width: number, height: number): PixelArt {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

function put(target: PixelArt, x: number, y: number, color: Rgba): void {
  if (x < 0 || y < 0 || x >= target.width || y >= target.height) return;
  target.data.set(color, (y * target.width + x) * 4);
}

const SHADOW: Rgba = [0, 0, 0, Math.round(0.28 * 255)];
const MARKER: Rgba = [255, 255, 255, Math.round(0.8 * 255)];
const SPEAKING: Rgba = [0x3f, 0xb9, 0x50, 255];

/** 타원 안쪽 거리 (픽셀 가운데 기준, 1이면 가장자리) */
const ellipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) =>
  ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2;

export function shadowArt(): PixelArt {
  const out = art(14, 5);
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 14; x++) if (ellipse(x, y, 7, 2.5, 7, 2.5) <= 1) put(out, x, y, SHADOW);
  }
  return out;
}

/** 클릭한 곳 표시 */
export function targetMarkerArt(): PixelArt {
  const out = art(10, 6);
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < 10; x++) {
      const d = ellipse(x, y, 5, 3, 5, 3);
      if (d <= 1 && d >= 0.45) put(out, x, y, MARKER);
    }
  }
  return out;
}

/** 말하는 중 표시: 발밑의 초록 고리 */
export function speakingRingArt(): PixelArt {
  const out = art(18, 8);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 18; x++) {
      const d = ellipse(x, y, 9, 4, 9, 4);
      if (d <= 1 && d >= 0.5) put(out, x, y, SPEAKING);
    }
  }
  return out;
}

// ── 횡스크롤 하늘 ──

/** 횡스크롤 광장의 하늘색 (카메라 배경) */
export const SIDE_SKY = '#9fd8f5';

/** 픽셀 가운데가 타원 안이면 칠한다 */
function fillEllipse(
  target: PixelArt,
  color: Rgba,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): void {
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
    for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
      if (ellipse(x, y, cx, cy, rx, ry) <= 1) put(target, x, y, color);
    }
  }
}

const CLOUD_SHAPES = [
  {
    w: 40,
    h: 16,
    puffs: [
      [12, 9, 9, 6],
      [22, 7, 9, 7],
      [30, 10, 8, 5],
    ],
  },
  {
    w: 56,
    h: 20,
    puffs: [
      [12, 13, 10, 6],
      [24, 9, 11, 9],
      [38, 11, 10, 7],
      [47, 14, 8, 5],
    ],
  },
  {
    w: 32,
    h: 12,
    puffs: [
      [10, 7, 8, 5],
      [21, 6, 8, 5],
    ],
  },
] as const;

/** 구름 모양 수 */
export const CLOUD_VARIANTS = CLOUD_SHAPES.length;

/** 뭉게구름 세 가지 (흰 몸통, 아래쪽 옅은 그림자) */
export function cloudArt(variant: number): PixelArt {
  const shape = CLOUD_SHAPES[variant % CLOUD_SHAPES.length]!;
  const out = art(shape.w, shape.h);
  const shade: Rgba = [0xdc, 0xec, 0xf7, 255];
  const white: Rgba = [255, 255, 255, 255];
  for (const [cx, cy, rx, ry] of shape.puffs) fillEllipse(out, shade, cx, cy + 1, rx, ry);
  for (const [cx, cy, rx, ry] of shape.puffs)
    fillEllipse(out, white, cx, cy - 0.5, rx - 0.5, ry - 1);
  return out;
}

/** 멀리 보이는 언덕 띠 (가로로 이어 붙여도 이어지게 폭 안에서 한 바퀴 도는 물결) */
export function hillsArt(): PixelArt {
  const width = 192;
  const height = 48;
  const out = art(width, height);
  const layers = [
    { color: [0xc6, 0xe6, 0xc0, 255], base: 18, amp: [9, 4], freq: [1, 3] },
    { color: [0xac, 0xd8, 0xa0, 255], base: 30, amp: [6, 3], freq: [2, 5] },
  ] as const;
  for (const layer of layers) {
    for (let x = 0; x < width; x++) {
      const t = (x / width) * Math.PI * 2;
      const top = Math.round(
        layer.base +
          layer.amp[0] * Math.sin(t * layer.freq[0]) +
          layer.amp[1] * Math.sin(t * layer.freq[1] + 1),
      );
      for (let y = Math.max(0, top); y < height; y++) put(out, x, y, layer.color);
    }
  }
  return out;
}
