import { type AssetAnimation, type AssetManifest, decodeFrame } from '@metacode/shared';
import { paletteColors } from './pixelCanvas';

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

/**
 * 텍스처 한 변의 최대 크기. 프레임을 한 줄로 늘어놓은 시트가 오래된 GPU의 WebGL 한계(4096px)를
 * 넘을 수 있어서, 넘칠 만큼 길어지면 여러 줄로 나눈다.
 */
export const SHEET_MAX_SIZE = 4096;

/** 시트에서 프레임 한 칸의 크기 (프레임을 줄여 담으면 원래 해상도보다 작다) */
export interface SheetCell {
  width: number;
  height: number;
}

/** 시트 한 줄에 들어가는 프레임 수 */
export function sheetColumns(
  manifest: Pick<AssetManifest, 'width' | 'frames'>,
  cellWidth = manifest.width,
): number {
  const perRow = Math.max(1, Math.floor(SHEET_MAX_SIZE / cellWidth));
  return Math.max(1, Math.min(manifest.frames.length, perRow));
}

/**
 * 시트 칸 크기: 가장 긴 변이 maxSide를 넘으면 비율대로 줄인다. 광장에서 캐릭터는 세로 2타일(배율 6배라도
 * 192px)이라 512×512 그림을 그대로 텍스처로 올리면 GPU 메모리만 크게 쓰고(32장이면 32MB) 화면에서는
 * 거칠게 줄어든다. 미리 부드럽게 줄여 두면 메모리도 작고 보기도 낫다.
 */
export function sheetCell(
  manifest: Pick<AssetManifest, 'width' | 'height'>,
  maxSide = Infinity,
): SheetCell {
  const longest = Math.max(manifest.width, manifest.height);
  if (longest <= maxSide) return { width: manifest.width, height: manifest.height };
  const scale = maxSide / longest;
  return {
    width: Math.max(1, Math.round(manifest.width * scale)),
    height: Math.max(1, Math.round(manifest.height * scale)),
  };
}

/** 모든 프레임을 늘어놓은 그림 (프레임 i는 x = (i % cols) * cell.width, y = floor(i / cols) * cell.height) */
export function sheetCanvas(
  manifest: AssetManifest,
  palette: readonly string[] = manifest.palette,
  cell: SheetCell = { width: manifest.width, height: manifest.height },
): HTMLCanvasElement {
  const { width, height, frames } = manifest;
  const cols = sheetColumns(manifest, cell.width);
  const canvas = document.createElement('canvas');
  canvas.width = cell.width * Math.min(cols, Math.max(1, frames.length));
  canvas.height = cell.height * Math.ceil(Math.max(1, frames.length) / cols);
  const ctx = canvas.getContext('2d')!;
  const scaled = cell.width !== width || cell.height !== height;
  const buffer = scaled ? document.createElement('canvas') : null;
  if (buffer) {
    buffer.width = width;
    buffer.height = height;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }
  frames.forEach((_, i) => {
    const image = new ImageData(framePixels(manifest, i, palette), width, height);
    const x = (i % cols) * cell.width;
    const y = Math.floor(i / cols) * cell.height;
    if (!buffer) {
      ctx.putImageData(image, x, y);
      return;
    }
    buffer.getContext('2d')!.putImageData(image, 0, 0);
    ctx.drawImage(buffer, x, y, cell.width, cell.height);
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
