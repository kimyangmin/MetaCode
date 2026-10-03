import {
  type PixelArt,
  cloudArt,
  hillsArt,
  shadowArt,
  speakingRingArt,
  targetMarkerArt,
} from '@metacode/client';

/**
 * 광장의 작은 표시를 캔버스로 (씬이 텍스처로 등록해서 쓴다). 픽셀은 네이티브 앱과 같은 규칙으로
 * packages/client가 만든다.
 */

export { SIDE_SKY } from '@metacode/client';

function toCanvas(art: PixelArt): HTMLCanvasElement {
  const el = document.createElement('canvas');
  el.width = art.width;
  el.height = art.height;
  el.getContext('2d')!.putImageData(new ImageData(art.data, art.width, art.height), 0, 0);
  return el;
}

export const drawShadow = () => toCanvas(shadowArt());
/** 클릭한 곳 표시 */
export const drawTargetMarker = () => toCanvas(targetMarkerArt());
/** 말하는 중 표시: 발밑의 초록 고리 */
export const drawSpeakingRing = () => toCanvas(speakingRingArt());
/** 뭉게구름 세 가지 */
export const drawCloud = (variant: number) => toCanvas(cloudArt(variant));
/** 멀리 보이는 언덕 띠 */
export const drawHills = () => toCanvas(hillsArt());
