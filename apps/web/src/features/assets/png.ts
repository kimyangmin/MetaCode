// 그림 → 팔레트 픽셀 변환은 네이티브 앱과 함께 쓴다 (packages/client/src/editor/indexImage.ts)
export { type ImportResult, indexImage, quantizeFrames } from '@metacode/client';

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
