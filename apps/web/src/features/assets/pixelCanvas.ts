import { paletteColors } from '@metacode/client';

export { paletteColors, rgb } from '@metacode/client';

/** 팔레트 픽셀 한 장(0 = 투명)을 원래 크기 캔버스로 (도트 에디터·애니메이터 미리보기·내보내기) */
export function frameCanvas(
  pixels: Uint16Array,
  width: number,
  height: number,
  palette: readonly string[],
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const image = new ImageData(width, height);
  const colorOf = paletteColors(palette);
  pixels.forEach((v, i) => {
    const c = colorOf(v);
    if (!c) return;
    image.data.set([c[0], c[1], c[2], 255], i * 4);
  });
  canvas.getContext('2d')!.putImageData(image, 0, 0);
  return canvas;
}

/** 캔버스를 PNG 바이트로 (ZIP에 담을 때) */
export function canvasPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error('PNG로 바꾸지 못했습니다.'));
      else void blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
    }, 'image/png');
  });
}
