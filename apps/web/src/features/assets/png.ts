import { PALETTE_MAX_COLORS } from '@metacode/shared';

const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

function channels(color: string): [number, number, number] {
  const v = parseInt(color.slice(1), 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

/** 팔레트에서 가장 가까운 색의 픽셀 값 (1부터) */
function nearest(palette: string[], r: number, g: number, b: number): number {
  let best = 1;
  let bestDistance = Infinity;
  palette.forEach((color, i) => {
    const [pr, pg, pb] = channels(color);
    const distance = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
    if (distance < bestDistance) {
      best = i + 1;
      bestDistance = distance;
    }
  });
  return best;
}

export type ImportResult = { frames: Uint8Array[]; palette: string[] } | { error: string };

/**
 * 가져온 그림(RGBA)을 팔레트 픽셀 프레임으로. 프레임 크기 그대로이거나, 같은 높이의 프레임을
 * 가로로 이어 붙인 시트여야 한다. 반투명(알파 128 미만)은 투명으로 본다.
 * 팔레트에 없는 색은 자리가 있으면 더하고, 64색이 넘으면 가장 가까운 색으로 바꾼다.
 */
export function indexImage(
  rgba: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number,
  palette: readonly string[],
): ImportResult {
  if (imageHeight !== frameHeight || imageWidth % frameWidth !== 0) {
    return {
      error: `그림 크기가 ${frameWidth}×${frameHeight}(또는 가로로 이어 붙인 시트)이어야 합니다. 가져온 그림: ${imageWidth}×${imageHeight}`,
    };
  }
  const next = [...palette];
  const lookup = new Map(next.map((color, i) => [color, i + 1]));
  const count = imageWidth / frameWidth;
  const frames = Array.from({ length: count }, () => new Uint8Array(frameWidth * frameHeight));
  for (let y = 0; y < imageHeight; y++) {
    for (let x = 0; x < imageWidth; x++) {
      const o = (y * imageWidth + x) * 4;
      if (rgba[o + 3]! < 128) continue;
      const [r, g, b] = [rgba[o]!, rgba[o + 1]!, rgba[o + 2]!];
      const color = hex(r, g, b);
      let value = lookup.get(color);
      if (value === undefined) {
        if (next.length < PALETTE_MAX_COLORS) {
          value = next.push(color);
          lookup.set(color, value);
        } else {
          value = nearest(next, r, g, b);
        }
      }
      const frame = Math.floor(x / frameWidth);
      frames[frame]![y * frameWidth + (x % frameWidth)] = value;
    }
  }
  return { frames, palette: next };
}

/** 파일 → RGBA (브라우저에서 그림을 읽는다) */
export async function readImageFile(
  file: File,
): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return {
    rgba: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
    width: canvas.width,
    height: canvas.height,
  };
}

/** 캔버스를 PNG 파일로 내려받는다 */
export function downloadCanvas(canvas: HTMLCanvasElement, fileName: string): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}
