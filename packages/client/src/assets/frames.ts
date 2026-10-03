import { type AssetAnimation, type AssetManifest, decodeFrame } from '@metacode/shared';

/** "#rrggbb" → [r, g, b] */
export function rgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

/**
 * 픽셀 값(1부터) → [r, g, b] (0이나 팔레트 밖은 undefined). 쓰는 색만 그때 바꾼다: 팔레트에 색이 아주 많아도
 * (색 제한 없음) 한 장 그릴 때마다 모든 색을 바꾸지 않게.
 */
export function paletteColors(
  palette: readonly string[],
): (value: number) => [number, number, number] | undefined {
  const cache: ([number, number, number] | undefined)[] = [];
  return (value) => {
    if (value <= 0 || value > palette.length) return undefined;
    return (cache[value] ??= rgb(palette[value - 1]!));
  };
}

/** 팔레트 픽셀 한 장을 RGBA로. palette를 주면 매니페스트 팔레트 대신 쓴다 (캐릭터 색 바꾸기) */
export function framePixels(
  manifest: AssetManifest,
  frame: number,
  palette: readonly string[] = manifest.palette,
): Uint8ClampedArray<ArrayBuffer> {
  const { width, height } = manifest;
  const out = new Uint8ClampedArray(width * height * 4);
  const pixels = decodeFrame(manifest.frames[frame] ?? '');
  if (!pixels) return out;
  const colorOf = paletteColors(palette);
  for (let i = 0; i < Math.min(pixels.length, width * height); i++) {
    const color = colorOf(pixels[i]!);
    if (!color) continue;
    out[i * 4] = color[0];
    out[i * 4 + 1] = color[1];
    out[i * 4 + 2] = color[2];
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** 애니메이션을 시작하고 elapsedMs가 지났을 때 보일 프레임 번호 (반복) */
export function frameAt(animation: AssetAnimation, elapsedMs: number): number {
  const { frames, frameMs } = animation;
  const step = Math.floor(Math.max(0, elapsedMs) / frameMs) % frames.length;
  return frames[step]!;
}

/** 한 번만 재생하는 애니메이션: 끝나면 마지막 프레임에 머문다 */
export function frameOnce(animation: AssetAnimation, elapsedMs: number): number {
  const { frames, frameMs } = animation;
  const step = Math.min(frames.length - 1, Math.floor(Math.max(0, elapsedMs) / frameMs));
  return frames[step]!;
}

export function isAnimated(animation: AssetAnimation | undefined): boolean {
  return !!animation && new Set(animation.frames).size > 1;
}
