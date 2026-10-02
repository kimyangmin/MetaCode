/**
 * 도트 에디터의 선택 영역 계산 (올가미, 자르기). 모두 프레임 한 장 크기의 배열을 받아 새 배열을 돌려준다.
 * 마스크는 프레임과 같은 크기의 0/1 배열이다.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 올가미로 그린 다각형 안의 픽셀. 좌표는 픽셀 단위 실수이고, 픽셀 가운데가 안에 있으면 고른다 (짝홀 규칙).
 * 올가미가 지나간 픽셀도 고른다 (얇게 그어도 빠지지 않게).
 */
export function lassoMask(points: Point[], width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  if (points.length === 0) return mask;
  for (const p of points) {
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    if (x >= 0 && y >= 0 && x < width && y < height) mask[y * width + x] = 1;
  }
  if (points.length < 3) return mask;
  for (let y = 0; y < height; y++) {
    const cy = y + 0.5;
    // 이 줄과 만나는 변의 x 좌표들
    const xs: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!;
      const b = points[(i + 1) % points.length]!;
      if (a.y <= cy === b.y <= cy) continue;
      xs.push(a.x + ((cy - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const from = Math.max(0, Math.ceil(xs[i]! - 0.5));
      const to = Math.min(width - 1, Math.floor(xs[i + 1]! - 0.5));
      for (let x = from; x <= to; x++) mask[y * width + x] = 1;
    }
  }
  return mask;
}

/** 두 점(양 끝 칸 포함)으로 만든 사각형. 그림 밖은 잘라 낸다 */
export function rectFrom(a: Point, b: Point, width: number, height: number): Rect {
  const x0 = Math.max(0, Math.min(a.x, b.x));
  const y0 = Math.max(0, Math.min(a.y, b.y));
  const x1 = Math.min(width - 1, Math.max(a.x, b.x));
  const y1 = Math.min(height - 1, Math.max(a.y, b.y));
  return { x: x0, y: y0, w: Math.max(1, x1 - x0 + 1), h: Math.max(1, y1 - y0 + 1) };
}

export function rectMask(rect: Rect, width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let y = rect.y; y < Math.min(height, rect.y + rect.h); y++) {
    for (let x = rect.x; x < Math.min(width, rect.x + rect.w); x++) mask[y * width + x] = 1;
  }
  return mask;
}

export function isEmptyMask(mask: Uint8Array): boolean {
  return !mask.some((v) => v);
}

/** 마스크를 감싸는 가장 작은 사각형 (비었으면 null) */
export function maskBounds(mask: Uint8Array, width: number): Rect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  mask.forEach((v, i) => {
    if (!v) return;
    const x = i % width;
    const y = Math.floor(i / width);
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  });
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** 통째로 (dx, dy)만큼 옮긴다. 밖으로 나간 부분은 버린다 (픽셀 값이나 마스크) */
export function shiftPixels<T extends Uint8Array | Uint16Array>(
  pixels: T,
  width: number,
  height: number,
  dx: number,
  dy: number,
): T {
  const next = pixels.slice().fill(0) as T;
  for (let y = 0; y < height; y++) {
    const ny = y + dy;
    if (ny < 0 || ny >= height) continue;
    for (let x = 0; x < width; x++) {
      const nx = x + dx;
      if (nx < 0 || nx >= width) continue;
      next[ny * width + nx] = pixels[y * width + x]!;
    }
  }
  return next;
}

/**
 * 사각형 안을 좌우(x) 또는 상하(y)로 뒤집는다 (밖은 그대로). 고른 영역을 그 자리에서 뒤집을 때, 픽셀 값과
 * 마스크에 같은 사각형(마스크를 감싸는 범위)으로 쓴다.
 */
export function flipWithin<T extends Uint8Array | Uint16Array>(
  pixels: T,
  rect: Rect,
  width: number,
  axis: 'x' | 'y',
): T {
  const next = pixels.slice() as T;
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const sx = axis === 'x' ? rect.x + rect.w - 1 - (x - rect.x) : x;
      const sy = axis === 'y' ? rect.y + rect.h - 1 - (y - rect.y) : y;
      next[y * width + x] = pixels[sy * width + sx]!;
    }
  }
  return next;
}

/** 마스크 안만 남긴 값 (밖은 0) */
export function maskedValues(pixels: Uint16Array, mask: Uint8Array): Uint16Array {
  return pixels.map((v, i) => (mask[i] ? v : 0));
}

/** 마스크 안을 투명하게 */
export function clearMasked(pixels: Uint16Array, mask: Uint8Array): Uint16Array {
  return pixels.map((v, i) => (mask[i] ? 0 : v));
}

/** base 위에 values를 얹는다. 마스크 안의 투명한 칸은 base가 비친다 */
export function stamp(base: Uint16Array, values: Uint16Array, mask: Uint8Array): Uint16Array {
  return base.map((v, i) => (mask[i] && values[i] ? values[i]! : v));
}

/**
 * 복사한 조각. 크기가 다른 그림(해상도를 바꾼 캐릭터 등)에도 붙일 수 있게 감싸는 사각형 기준으로 담는다.
 */
export interface Clip {
  rect: Rect;
  values: Uint16Array;
  mask: Uint8Array;
}

export function copyClip(pixels: Uint16Array, mask: Uint8Array, width: number): Clip | null {
  const rect = maskBounds(mask, width);
  if (!rect) return null;
  const values = new Uint16Array(rect.w * rect.h);
  const clipMask = new Uint8Array(rect.w * rect.h);
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const i = (rect.y + y) * width + rect.x + x;
      if (!mask[i]) continue;
      clipMask[y * rect.w + x] = 1;
      values[y * rect.w + x] = pixels[i]!;
    }
  }
  return { rect, values, mask: clipMask };
}

/** 복사한 자리에 그대로 펼친다 (그림 밖은 버림) */
export function placeClip(
  clip: Clip,
  width: number,
  height: number,
): { values: Uint16Array; mask: Uint8Array } {
  const values = new Uint16Array(width * height);
  const mask = new Uint8Array(width * height);
  const { rect } = clip;
  for (let y = 0; y < rect.h; y++) {
    const ty = rect.y + y;
    if (ty >= height) break;
    for (let x = 0; x < rect.w; x++) {
      const tx = rect.x + x;
      if (tx >= width || !clip.mask[y * rect.w + x]) continue;
      mask[ty * width + tx] = 1;
      values[ty * width + tx] = clip.values[y * rect.w + x]!;
    }
  }
  return { values, mask };
}

/** 선택 테두리: 마스크 안 칸과 밖 칸이 맞닿은 변들 (픽셀 좌표) */
export function maskOutline(
  mask: Uint8Array,
  width: number,
  height: number,
): [number, number, number, number][] {
  const inside = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;
  const edges: [number, number, number, number][] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inside(x, y)) continue;
      if (!inside(x, y - 1)) edges.push([x, y, x + 1, y]);
      if (!inside(x, y + 1)) edges.push([x, y + 1, x + 1, y + 1]);
      if (!inside(x - 1, y)) edges.push([x, y, x, y + 1]);
      if (!inside(x + 1, y)) edges.push([x + 1, y, x + 1, y + 1]);
    }
  }
  return edges;
}

/** 맨 아래부터 비어 있는 줄 수 (그림이 없으면 height) */
export function emptyRowsBelow(pixels: Uint16Array, width: number, height: number): number {
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) if (pixels[y * width + x]) return height - 1 - y;
  }
  return height;
}
