import sharp from 'sharp';

/** 화면에 바로 보여 줄 수 있는 이미지 형식. 파일 앞부분(매직 바이트)으로만 판단한다. */
export type RasterFormat = 'jpeg' | 'png' | 'gif' | 'webp' | 'avif';

export const IMAGE_CONTENT_TYPES: Record<RasterFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
};

/** 형식 판별에 필요한 앞부분 길이 */
export const SNIFF_BYTES = 32;

/**
 * 파일 앞부분을 보고 래스터 이미지인지 판단한다.
 * 확장자나 브라우저가 알려 준 형식은 믿지 않는다. SVG처럼 스크립트를 품을 수 있는 형식은
 * 이미지로 취급하지 않고 일반 파일(다운로드)로 둔다.
 */
export function sniffRasterFormat(head: Buffer): RasterFormat | null {
  const ascii = (start: number, end: number) => head.subarray(start, end).toString('latin1');
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return 'gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (ascii(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 12))) return 'avif';
  return null;
}

export const THUMBNAIL_MAX_PX = 480;

/** 압축 폭탄(작은 파일이 엄청난 해상도로 풀리는 것)을 막는다: 약 1억 화소까지 */
const MAX_INPUT_PIXELS = 100_000_000;

export interface ProcessedImage {
  width: number;
  height: number;
  thumbnail: Buffer;
}

/**
 * 원본 크기를 읽고 채팅에 보여 줄 썸네일(WebP, 긴 변 480px 이하)을 만든다.
 * 움직이는 GIF/WebP는 첫 프레임으로 만든다. 읽을 수 없는 파일이면 null (일반 파일로 둔다).
 */
export async function processImage(input: Buffer): Promise<ProcessedImage | null> {
  try {
    const image = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, animated: false });
    const meta = await image.metadata();
    if (!meta.width || !meta.height) return null;
    // EXIF 방향(휴대폰 사진)을 반영한 실제 보이는 크기
    const rotated = (meta.orientation ?? 1) >= 5;
    const thumbnail = await image
      .rotate()
      .resize(THUMBNAIL_MAX_PX, THUMBNAIL_MAX_PX, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    return {
      width: rotated ? meta.height : meta.width,
      height: rotated ? meta.width : meta.height,
      thumbnail,
    };
  } catch {
    return null;
  }
}

/** 올린 사진에서 쓸 곳: 원본(EXIF 방향을 반영해 보이는 그대로) 기준 0~1 비율 */
export interface CropRatio {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 비율로 받은 자를 곳을 실제 픽셀로 바꾼다. 사진 밖으로 나가지 않게 맞추고, 적어도 1픽셀은 남긴다.
 */
export function cropPixels(
  crop: CropRatio,
  width: number,
  height: number,
): { left: number; top: number; width: number; height: number } {
  const left = Math.min(width - 1, Math.max(0, Math.round(crop.x * width)));
  const top = Math.min(height - 1, Math.max(0, Math.round(crop.y * height)));
  return {
    left,
    top,
    width: Math.max(1, Math.min(width - left, Math.round(crop.width * width))),
    height: Math.max(1, Math.min(height - top, Math.round(crop.height * height))),
  };
}

/**
 * 프로필 사진: 정사각형(size px) WebP. crop이 없으면 가운데를 기준으로 자른다.
 * 움직이는 이미지는 첫 프레임으로 만든다. 읽을 수 없는 파일이면 null
 */
export async function makeAvatar(
  input: Buffer,
  size: number,
  crop?: CropRatio,
): Promise<Buffer | null> {
  return makeCover(input, size, size, crop);
}

/**
 * 커뮤니티 아이콘·배너, 프로필 사진: crop으로 고른 곳(없으면 가운데)을 width×height로 채운 WebP.
 * 고른 곳의 비율이 조금 달라도 가운데를 채워 맞춘다. 이미지가 아니면 null
 */
export async function makeCover(
  input: Buffer,
  width: number,
  height: number,
  crop?: CropRatio,
): Promise<Buffer | null> {
  try {
    const options = { limitInputPixels: MAX_INPUT_PIXELS, animated: false };
    let image = sharp(input, options).rotate();
    if (crop) {
      // 사용자는 회전된(보이는) 사진 위에서 골랐으므로, 회전을 먼저 반영한 크기로 잰다.
      const meta = await sharp(input, options).metadata();
      if (!meta.width || !meta.height) return null;
      const rotated = (meta.orientation ?? 1) >= 5;
      const shown = rotated
        ? { width: meta.height, height: meta.width }
        : { width: meta.width, height: meta.height };
      // rotate() 다음에 extract()를 부르면 회전한 뒤의 사진에서 자른다 (sharp는 부른 순서대로 적용).
      image = image.extract(cropPixels(crop, shown.width, shown.height));
    }
    return await image.resize(width, height, { fit: 'cover' }).webp({ quality: 85 }).toBuffer();
  } catch {
    return null;
  }
}
