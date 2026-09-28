/** 픽셀 한 장 = 팔레트 인덱스 배열 (row-major, 0 = 투명). JSON에는 base64로 담는다. */

export function encodePixels(pixels: Uint8Array): string {
  let binary = '';
  for (const value of pixels) binary += String.fromCharCode(value);
  return btoa(binary);
}

/** 형식이 틀리면 null */
export function decodePixels(encoded: string): Uint8Array | null {
  let binary: string;
  try {
    binary = atob(encoded);
  } catch {
    return null;
  }
  const pixels = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) pixels[i] = binary.charCodeAt(i);
  return pixels;
}

export function isBlank(pixels: Uint8Array): boolean {
  return pixels.every((value) => value === 0);
}

function channels(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * 색 하나에서 밝은 면, 그림자, 외곽선 세 색을 만든다. 캐릭터 색 바꾸기(colorSlots)는
 * 고른 색 하나로 부위의 세 팔레트 칸을 이 순서로 채운다.
 */
export function colorRamp(hex: string): [string, string, string] {
  const [r, g, b] = channels(hex);
  const shade = (k: number, towards: [number, number, number]) =>
    toHex([
      r * k + towards[0] * (1 - k),
      g * k + towards[1] * (1 - k),
      b * k + towards[2] * (1 - k),
    ]);
  // 그림자는 약간 차가운 쪽으로, 외곽선은 Kenney 외곽선 색(#3f2631) 쪽으로 어둡게 한다.
  return [hex.toLowerCase(), shade(0.72, [40, 30, 70]), shade(0.35, [63, 38, 49])];
}
