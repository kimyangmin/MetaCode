import { type MapLayout, TILE_SIZE } from '@metacode/shared';

/** 분수 광장처럼 넓은 맵의 기본 배율. 카메라가 내 캐릭터를 따라간다 */
export const DEFAULT_ZOOM = 3;
/** 넓은 맵에서 패널이 좁아도 이만큼(타일)은 보이도록 배율을 낮춘다 */
const MIN_VISIBLE_TILES = { width: 10, height: 8 };
const MAX_FIT_ZOOM = 6;
/** 이보다 작은 맵(모닥불 캠프 16×12)은 맵 전체를 한 화면에 보여 준다 (타일 단위) */
const FIT_MAX = { width: 20, height: 16 };

/** 사용자가 Ctrl +/−로 고를 수 있는 배율 범위 */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 6;

/** 패널 크기에 맞춘 기본 배율 (사용자가 바꾸기 전) */
function autoZoom(layout: MapLayout, width: number, height: number): number {
  if (layout.width <= FIT_MAX.width && layout.height <= FIT_MAX.height) {
    const fit = Math.floor(
      Math.min(width / (layout.width * TILE_SIZE), height / (layout.height * TILE_SIZE)),
    );
    return Math.min(MAX_FIT_ZOOM, Math.max(1, fit));
  }
  const cap = Math.floor(
    Math.min(
      width / (MIN_VISIBLE_TILES.width * TILE_SIZE),
      height / (MIN_VISIBLE_TILES.height * TILE_SIZE),
    ),
  );
  return Math.max(1, Math.min(DEFAULT_ZOOM, cap));
}

/**
 * 화면 배율. 도트가 뭉개지지 않게 항상 정수다.
 * 작은 맵(모닥불 캠프)은 맵 전체가 패널에 들어오는 가장 큰 배율, 넓은 맵(분수 광장)은 기본 배율(좁으면 낮춤).
 * offset은 사용자가 Ctrl +/−로 더하거나 뺀 단계다 (패널 크기가 바뀌어도 기본 배율에서 그만큼 떨어진다).
 */
export function zoomFor(layout: MapLayout, width: number, height: number, offset = 0): number {
  const zoom = autoZoom(layout, width, height) + offset;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/**
 * 배율을 한 단계 바꾼 뒤의 offset. 범위 끝에서는 더 쌓이지 않게 한다
 * (끝에서 여러 번 눌러도 반대로 한 번 누르면 바로 바뀌도록).
 */
export function stepZoomOffset(
  layout: MapLayout,
  width: number,
  height: number,
  offset: number,
  step: 1 | -1,
): number {
  const base = autoZoom(layout, width, height);
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, base + offset + step));
  return next - base;
}
