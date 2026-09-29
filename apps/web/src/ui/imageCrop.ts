import type { ImageCrop } from '@metacode/shared';

/**
 * 사진 위치 조정의 계산. 틀(frame)은 화면에 고정되어 있고, 사진을 끌어 옮기고 확대한다.
 * 상태는 "틀 가운데가 사진의 어디에 있는지"(center, 사진 기준 0~1)와 확대 배율(zoom, 1 = 틀을 꽉 채우는 최소 크기)이다.
 */
export interface CropView {
  /** 틀 가운데가 가리키는 사진 위의 점 (0~1) */
  cx: number;
  cy: number;
  /** 1이면 사진이 틀을 겨우 덮는 크기, 클수록 확대 */
  zoom: number;
}

export interface Size {
  width: number;
  height: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 5;

/** 사진 1픽셀이 화면에서 몇 픽셀인지: 틀을 덮는 최소 배율 × zoom */
export function displayScale(image: Size, frame: Size, zoom: number): number {
  return Math.max(frame.width / image.width, frame.height / image.height) * zoom;
}

/** 틀이 사진에서 차지하는 크기 (0~1 비율) */
function frameRatio(image: Size, frame: Size, zoom: number): Size {
  const scale = displayScale(image, frame, zoom);
  return {
    width: Math.min(1, frame.width / (image.width * scale)),
    height: Math.min(1, frame.height / (image.height * scale)),
  };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** 틀이 사진 밖으로 나가지 않게 가운데와 배율을 맞춘다 */
export function clampView(view: CropView, image: Size, frame: Size): CropView {
  const zoom = clamp(view.zoom, MIN_ZOOM, MAX_ZOOM);
  const ratio = frameRatio(image, frame, zoom);
  return {
    zoom,
    cx: clamp(view.cx, ratio.width / 2, 1 - ratio.width / 2),
    cy: clamp(view.cy, ratio.height / 2, 1 - ratio.height / 2),
  };
}

/** 화면에서 dx, dy만큼 끌었을 때: 사진이 손을 따라 움직이므로 틀 가운데는 반대로 간다 */
export function panView(
  view: CropView,
  image: Size,
  frame: Size,
  dx: number,
  dy: number,
): CropView {
  const scale = displayScale(image, frame, view.zoom);
  return clampView(
    {
      ...view,
      cx: view.cx - dx / (image.width * scale),
      cy: view.cy - dy / (image.height * scale),
    },
    image,
    frame,
  );
}

/** 배율을 바꾼다 (틀 가운데를 기준으로) */
export function zoomView(view: CropView, image: Size, frame: Size, zoom: number): CropView {
  return clampView({ ...view, zoom }, image, frame);
}

/** 서버에 보낼 자를 곳 (사진 기준 0~1) */
export function cropOf(view: CropView, image: Size, frame: Size): ImageCrop {
  const ratio = frameRatio(image, frame, view.zoom);
  return {
    x: clamp(view.cx - ratio.width / 2, 0, 1 - ratio.width),
    y: clamp(view.cy - ratio.height / 2, 0, 1 - ratio.height),
    width: ratio.width,
    height: ratio.height,
  };
}

/** 화면에 그릴 사진의 위치와 크기 (틀 왼쪽 위 기준, px) */
export function imagePlacement(
  view: CropView,
  image: Size,
  frame: Size,
): { left: number; top: number; width: number; height: number } {
  const scale = displayScale(image, frame, view.zoom);
  const width = image.width * scale;
  const height = image.height * scale;
  return {
    left: frame.width / 2 - view.cx * width,
    top: frame.height / 2 - view.cy * height,
    width,
    height,
  };
}

export const INITIAL_VIEW: CropView = { cx: 0.5, cy: 0.5, zoom: 1 };
