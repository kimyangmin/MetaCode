import { type AssetAnimation, type AssetManifest, decodePixels } from '@metacode/shared';

/** '#rrggbb' → [r, g, b] */
function rgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

/** 팔레트 픽셀 한 장을 RGBA로. palette를 주면 매니페스트 팔레트 대신 쓴다 (캐릭터 색 바꾸기) */
export function framePixels(
  manifest: AssetManifest,
  frame: number,
  palette: readonly string[] = manifest.palette,
): Uint8ClampedArray<ArrayBuffer> {
  const { width, height } = manifest;
  const out = new Uint8ClampedArray(width * height * 4);
  const pixels = decodePixels(manifest.frames[frame] ?? '');
  if (!pixels) return out;
  const colors = palette.map(rgb);
  for (let i = 0; i < Math.min(pixels.length, width * height); i++) {
    const v = pixels[i]!;
    const color = v > 0 ? colors[v - 1] : undefined;
    if (!color) continue;
    out[i * 4] = color[0];
    out[i * 4 + 1] = color[1];
    out[i * 4 + 2] = color[2];
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** 모든 프레임을 가로로 늘어놓은 그림 (프레임 i는 x = i * width) */
export function sheetCanvas(
  manifest: AssetManifest,
  palette: readonly string[] = manifest.palette,
): HTMLCanvasElement {
  const { width, height, frames } = manifest;
  const canvas = document.createElement('canvas');
  canvas.width = width * frames.length;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  frames.forEach((_, i) => {
    ctx.putImageData(new ImageData(framePixels(manifest, i, palette), width, height), i * width, 0);
  });
  return canvas;
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
