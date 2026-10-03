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

export type ImportResult = { frames: Uint16Array[]; palette: string[] } | { error: string };

/**
 * 가져온 그림(RGBA)을 팔레트 픽셀 프레임으로. 프레임 크기 그대로이거나, 같은 높이의 프레임을
 * 가로로 이어 붙인 시트여야 한다. 반투명(알파 128 미만)은 투명으로 본다.
 * 팔레트에 없는 색은 더한다 (팔레트 한도를 넘으면 가장 가까운 색으로 바꾼다).
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
  const frames = Array.from({ length: count }, () => new Uint16Array(frameWidth * frameHeight));
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

type Rgb = [number, number, number];

/**
 * 중간값 자르기(median cut): 색들을 count개 상자로 나누고 상자마다 (많이 쓴 만큼 무게를 둔) 평균색을 고른다.
 * 색이 팔레트 한도보다 많은 그림을 한도 안으로 줄일 때 쓴다.
 */
function medianCut(colors: { rgb: Rgb; weight: number }[], count: number): Rgb[] {
  if (colors.length <= count) return colors.map((c) => c.rgb);
  // 남은 자리가 없으면 새 색을 하나도 더하지 않는다. 예전엔 상자 하나(평균색 한 개)를 돌려줘서, 팔레트가
  // 255색으로 차 있을 때 GIF를 가져오면 256색이 되어 저장이 막혔다.
  if (count <= 0) return [];
  let boxes = [colors];
  while (boxes.length < count) {
    // 색 범위가 가장 넓은 상자를 가장 넓은 채널에서 반으로 자른다.
    let best = -1;
    let bestRange = -1;
    let bestChannel = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      for (let c = 0; c < 3; c++) {
        let lo = 255;
        let hi = 0;
        for (const color of box) {
          lo = Math.min(lo, color.rgb[c]!);
          hi = Math.max(hi, color.rgb[c]!);
        }
        if (hi - lo > bestRange) {
          bestRange = hi - lo;
          best = i;
          bestChannel = c;
        }
      }
    });
    if (best === -1) break;
    const box = [...boxes[best]!].sort((a, b) => a.rgb[bestChannel]! - b.rgb[bestChannel]!);
    const total = box.reduce((sum, c) => sum + c.weight, 0);
    let acc = 0;
    let cut = 1;
    for (; cut < box.length - 1; cut++) {
      acc += box[cut - 1]!.weight;
      if (acc >= total / 2) break;
    }
    boxes = [...boxes.slice(0, best), box.slice(0, cut), box.slice(cut), ...boxes.slice(best + 1)];
  }
  return boxes.map((box) => {
    const total = box.reduce((sum, c) => sum + c.weight, 0);
    return [0, 1, 2].map((c) =>
      Math.round(box.reduce((sum, color) => sum + color.rgb[c]! * color.weight, 0) / total),
    ) as Rgb;
  });
}

/**
 * 여러 장의 RGBA 그림을 같은 팔레트의 픽셀 프레임으로. 지금 팔레트의 색은 그대로 두고 새 색을 모두 더한다.
 * 팔레트 한도(PALETTE_MAX_COLORS)를 넘을 만큼 많을 때만 중간값 자르기로 줄이고, 그 픽셀은 가장 가까운 색이 된다.
 * 반투명(알파 128 미만)은 투명이다.
 */
export function quantizeFrames(
  images: Uint8ClampedArray[],
  width: number,
  height: number,
  palette: readonly string[],
): { frames: Uint16Array[]; palette: string[] } {
  const known = new Set(palette.map((c) => c.toLowerCase()));
  const counts = new Map<number, number>();
  for (const rgba of images) {
    for (let o = 0; o < width * height * 4; o += 4) {
      if (rgba[o + 3]! < 128) continue;
      const key = (rgba[o]! << 16) | (rgba[o + 1]! << 8) | rgba[o + 2]!;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const fresh = [...counts]
    .filter(([key]) => !known.has(hex(key >> 16, (key >> 8) & 0xff, key & 0xff)))
    .map(([key, weight]) => ({
      rgb: [key >> 16, (key >> 8) & 0xff, key & 0xff] as Rgb,
      weight,
    }));
  const slots = Math.max(0, PALETTE_MAX_COLORS - palette.length);
  const next = [...palette, ...medianCut(fresh, slots).map(([r, g, b]) => hex(r, g, b))];
  // 팔레트에 똑같이 있는 색은 바로 찾는다 (색이 많을 때 가까운 색을 모두 견주면 느리다)
  const lookup = new Map<number, number>();
  next.forEach((color, i) => {
    const key = parseInt(color.slice(1), 16);
    if (!lookup.has(key)) lookup.set(key, i + 1);
  });
  const valueOf = (key: number) => {
    let value = lookup.get(key);
    if (value === undefined) {
      value = nearest(next, key >> 16, (key >> 8) & 0xff, key & 0xff);
      lookup.set(key, value);
    }
    return value;
  };
  const frames = images.map((rgba) => {
    const pixels = new Uint16Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const o = i * 4;
      if (rgba[o + 3]! < 128) continue;
      pixels[i] = valueOf((rgba[o]! << 16) | (rgba[o + 1]! << 8) | rgba[o + 2]!);
    }
    return pixels;
  });
  return { frames, palette: next };
}
