/**
 * 픽셀 한 장 = 팔레트 인덱스 배열 (row-major, 0 = 투명). JSON에는 base64로 담는다.
 *
 * 도트 그림은 투명한 곳과 같은 색이 길게 이어지므로, 줄인 길이(RLE)로 담는 것이 더 짧으면 그렇게 담는다
 * (앞에 RLE_PREFIX를 붙인다). 큰 캐릭터(256×512)도 저장·전송 크기가 작다. 읽을 때는 두 형식을 모두 받는다.
 */

/** RLE로 담은 픽셀의 머리표. base64 글자가 아니라 헷갈리지 않는다 */
export const RLE_PREFIX = '~';

/** 바이트 배열 → base64 (큰 배열도 스택이 넘치지 않게 나눠서 바꾼다) */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fromBase64(encoded: string): Uint8Array | null {
  let binary: string;
  try {
    binary = atob(encoded);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * PackBits와 비슷한 RLE: 머리 바이트 h가 0~127이면 뒤에 오는 h+1바이트를 그대로, 128~255면
 * 뒤의 한 바이트를 h-126번(2~129) 되풀이한다. 가장 나쁜 경우에도 128바이트마다 1바이트만 는다.
 */
export function rleEncode(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length + Math.ceil(bytes.length / 128) + 2);
  let o = 0;
  let literalStart = -1;
  const flushLiteral = (end: number) => {
    if (literalStart === -1) return;
    for (let start = literalStart; start < end; start += 128) {
      const count = Math.min(128, end - start);
      out[o++] = count - 1;
      out.set(bytes.subarray(start, start + count), o);
      o += count;
    }
    literalStart = -1;
  };
  let i = 0;
  while (i < bytes.length) {
    let run = 1;
    while (i + run < bytes.length && run < 129 && bytes[i + run] === bytes[i]) run++;
    if (run >= 3) {
      flushLiteral(i);
      out[o++] = run + 126;
      out[o++] = bytes[i]!;
      i += run;
    } else {
      if (literalStart === -1) literalStart = i;
      i += run;
    }
  }
  flushLiteral(bytes.length);
  return out.slice(0, o);
}

/** rleEncode의 반대. 형식이 틀리면 null */
export function rleDecode(encoded: Uint8Array, maxLength = Infinity): Uint8Array | null {
  const chunks: Uint8Array[] = [];
  let length = 0;
  let i = 0;
  while (i < encoded.length) {
    const head = encoded[i++]!;
    if (head < 128) {
      const count = head + 1;
      if (i + count > encoded.length) return null;
      chunks.push(encoded.subarray(i, i + count));
      i += count;
      length += count;
    } else {
      if (i >= encoded.length) return null;
      const count = head - 126;
      chunks.push(new Uint8Array(count).fill(encoded[i++]!));
      length += count;
    }
    if (length > maxLength) return null;
  }
  const out = new Uint8Array(length);
  let o = 0;
  for (const chunk of chunks) {
    out.set(chunk, o);
    o += chunk.length;
  }
  return out;
}

/** 픽셀 → 문자열. 그냥 base64와 RLE 중 짧은 것 (같은 픽셀이면 늘 같은 문자열) */
export function encodePixels(pixels: Uint8Array): string {
  const plain = toBase64(pixels);
  // 줄어들 여지가 없는 작은 그림(타일 16×16 등)도 확인하지만 비용은 작다.
  const packed = RLE_PREFIX + toBase64(rleEncode(pixels));
  return packed.length < plain.length ? packed : plain;
}

/**
 * 형식이 틀리면 null. maxLength를 주면 풀었을 때 그보다 길면 null이다
 * (작은 문자열이 엄청나게 큰 배열로 풀리는 것을 막는다: 서버 검증은 그림 크기를 준다).
 */
export function decodePixels(encoded: string, maxLength?: number): Uint8Array | null {
  if (encoded.startsWith(RLE_PREFIX)) {
    const packed = fromBase64(encoded.slice(RLE_PREFIX.length));
    return packed && rleDecode(packed, maxLength);
  }
  const plain = fromBase64(encoded);
  return plain && maxLength !== undefined && plain.length > maxLength ? null : plain;
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
