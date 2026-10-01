import { GifReader, GifWriter } from 'omggif';

/**
 * 도트 에디터의 GIF 가져오기·내보내기. 움직이는 GIF 하나를 애니메이션 하나(대기, 걷기, 모션 등)로 바꾸고,
 * 애니메이션을 투명 배경 GIF로 내보낸다. omggif(MIT)로 풀고 묶는다.
 */

/** 풀어 둔 GIF: 장면마다 그림 전체(RGBA)와 보여 줄 시간 */
export interface DecodedGif {
  width: number;
  height: number;
  frames: Uint8ClampedArray[];
  /** 장면마다 보여 줄 시간 (ms) */
  delays: number[];
}

/** GIF에 시간이 없거나 0이면 브라우저처럼 100ms로 본다 */
const DEFAULT_DELAY_MS = 100;
/** 너무 큰 GIF는 풀지 않는다 (에디터가 다룰 수 있는 크기보다 훨씬 큼) */
const MAX_GIF_PIXELS = 4096 * 4096;
const MAX_GIF_FRAMES = 256;

/**
 * GIF를 장면마다 그림 전체로 푼다. GIF는 장면이 앞 장면 위에 덧그리는 조각이고, 장면이 끝난 뒤 처리
 * (disposal: 그대로 둠 / 그 자리를 지움 / 앞 상태로 되돌림)가 있어서 그대로 따라 그린다.
 */
export function decodeGif(bytes: Uint8Array): DecodedGif {
  const reader = new GifReader(bytes);
  const { width, height } = reader;
  if (width * height > MAX_GIF_PIXELS) throw new Error('GIF가 너무 큽니다.');
  const count = Math.min(reader.numFrames(), MAX_GIF_FRAMES);
  const canvas = new Uint8ClampedArray(width * height * 4);
  const frames: Uint8ClampedArray[] = [];
  const delays: number[] = [];
  for (let i = 0; i < count; i++) {
    const info = reader.frameInfo(i);
    const before = info.disposal === 3 ? canvas.slice() : null;
    reader.decodeAndBlitFrameRGBA(i, canvas);
    frames.push(canvas.slice());
    delays.push(info.delay > 0 ? info.delay * 10 : DEFAULT_DELAY_MS);
    if (info.disposal === 2) {
      for (let y = info.y; y < Math.min(height, info.y + info.height); y++) {
        canvas.fill(
          0,
          (y * width + info.x) * 4,
          (y * width + Math.min(width, info.x + info.width)) * 4,
        );
      }
    } else if (before) {
      canvas.set(before);
    }
  }
  return { width, height, frames, delays };
}

/**
 * 키운 도트 그림의 배율: 모든 장면이 k×k 칸마다 한 색이면 k (도트 그림을 4배·8배로 키워 내보낸 GIF가 많다).
 * 몇 칸쯤 어긋나는 것(압축 잡티)은 봐준다. 그런 배율이 없으면 1
 */
export function detectPixelScale(gif: DecodedGif, maxScale = 16): number {
  const { width, height, frames } = gif;
  for (let k = maxScale; k >= 2; k--) {
    if (width % k !== 0 || height % k !== 0) continue;
    let blocks = 0;
    let mismatched = 0;
    for (const rgba of frames) {
      for (let by = 0; by < height; by += k) {
        for (let bx = 0; bx < width; bx += k) {
          blocks++;
          const first = (by * width + bx) * 4;
          let same = true;
          for (let y = by; y < by + k && same; y++) {
            for (let x = bx; x < bx + k; x++) {
              const o = (y * width + x) * 4;
              const transparent = rgba[o + 3]! < 128 && rgba[first + 3]! < 128;
              if (
                !transparent &&
                (rgba[o] !== rgba[first] ||
                  rgba[o + 1] !== rgba[first + 1] ||
                  rgba[o + 2] !== rgba[first + 2] ||
                  rgba[o + 3]! < 128 !== rgba[first + 3]! < 128)
              ) {
                same = false;
                break;
              }
            }
          }
          if (!same) mismatched++;
        }
      }
    }
    if (mismatched <= blocks * 0.01) return k;
  }
  return 1;
}

/** RGBA 그림을 k배 작게: k×k 칸의 가운데 픽셀을 쓴다 (키운 도트 그림이면 원래 그림 그대로) */
export function shrinkRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  k: number,
): Uint8ClampedArray {
  if (k <= 1) return rgba;
  const w = Math.floor(width / k);
  const h = Math.floor(height / k);
  const out = new Uint8ClampedArray(w * h * 4);
  const half = Math.floor(k / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const from = ((y * k + half) * width + x * k + half) * 4;
      out.set(rgba.subarray(from, from + 4), (y * w + x) * 4);
    }
  }
  return out;
}

/** 장면 시간들을 애니메이션 하나의 프레임 간격으로 (가운데 값) */
export function frameMsOf(delays: number[], min: number, max: number): number {
  const sorted = [...delays].sort((a, b) => a - b);
  const middle = sorted[Math.floor(sorted.length / 2)] ?? DEFAULT_DELAY_MS;
  return Math.min(max, Math.max(min, Math.round(middle / 10) * 10));
}

function rgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

/**
 * 팔레트 픽셀 프레임들(0 = 투명)을 움직이는 GIF로. scale배로 키우고(도트 그대로), 계속 되풀이한다.
 * GIF 팔레트의 0번은 투명이고 1번부터가 에셋 팔레트다.
 */
export function encodeGif(
  frames: Uint8Array[],
  width: number,
  height: number,
  palette: readonly string[],
  frameMs: number,
  scale = 1,
): Uint8Array<ArrayBuffer> {
  const w = width * scale;
  const h = height * scale;
  // GIF 팔레트 크기는 2의 거듭제곱이어야 한다.
  let size = 2;
  while (size < palette.length + 1) size *= 2;
  const colors = Array.from({ length: size }, (_, i) => {
    if (i === 0 || i > palette.length) return 0;
    const [r, g, b] = rgb(palette[i - 1]!);
    return (r << 16) | (g << 8) | b;
  });
  const buffer = new Uint8Array(w * h * frames.length * 2 + frames.length * 2048 + 4096);
  const writer = new GifWriter(buffer, w, h, { palette: colors, loop: 0 });
  const delay = Math.max(2, Math.round(frameMs / 10));
  for (const pixels of frames) {
    const indexed = new Array<number>(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        indexed[y * w + x] = pixels[Math.floor(y / scale) * width + Math.floor(x / scale)] ?? 0;
      }
    }
    // 장면이 끝나면 지워서(disposal 2) 투명한 곳에 앞 장면이 남지 않게 한다.
    writer.addFrame(0, 0, w, h, indexed, { delay, transparent: 0, disposal: 2 });
  }
  return buffer.slice(0, writer.end());
}

/** 파일을 내려받게 한다 */
export function downloadBytes(
  bytes: Uint8Array<ArrayBuffer>,
  fileName: string,
  type: string,
): void {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 그림을 프레임에 놓는 기준: 캐릭터는 발밑 가운데, 오브젝트는 왼쪽 아래(맵에 놓는 기준), 타일은 왼쪽 위 */
export type Anchor = 'bottom-center' | 'bottom-left' | 'top-left';

/** width×height 픽셀 프레임을 docWidth×docHeight 프레임의 기준 자리에 놓는다 (넘치는 곳은 잘린다) */
export function placePixels(
  pixels: Uint8Array,
  width: number,
  height: number,
  docWidth: number,
  docHeight: number,
  anchor: Anchor,
): Uint8Array {
  const out = new Uint8Array(docWidth * docHeight);
  const dx = anchor === 'bottom-center' ? Math.floor((docWidth - width) / 2) : 0;
  const dy = anchor === 'top-left' ? 0 : docHeight - height;
  for (let y = 0; y < height; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= docHeight) continue;
    for (let x = 0; x < width; x++) {
      const tx = x + dx;
      if (tx < 0 || tx >= docWidth) continue;
      out[ty * docWidth + tx] = pixels[y * width + x]!;
    }
  }
  return out;
}

/** 좌우 반전 (왼쪽 걷기로 오른쪽 걷기를 만들 때) */
export function mirrorPixels(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(pixels.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) out[y * width + (width - 1 - x)] = pixels[y * width + x]!;
  }
  return out;
}

/** 반대 방향 애니메이션 이름 (walk-left ↔ walk-right). 왼쪽·오른쪽이 아니면 null */
export function oppositeAnimation(name: string): string | null {
  if (name.endsWith('-left')) return `${name.slice(0, -5)}-right`;
  if (name.endsWith('-right')) return `${name.slice(0, -6)}-left`;
  return null;
}
