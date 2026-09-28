import { type MapLayout, TILE_SIZE } from '@metacode/shared';

/** 분수 광장처럼 넓은 맵의 기본 배율. 카메라가 내 캐릭터를 따라간다 */
export const DEFAULT_ZOOM = 3;
/** 넓은 맵에서 패널이 좁아도 이만큼(타일)은 보이도록 배율을 낮춘다 */
const MIN_VISIBLE_TILES = { width: 10, height: 8 };
const MAX_FIT_ZOOM = 6;
/** 이보다 작은 맵(모닥불 캠프 16×12)은 맵 전체를 한 화면에 보여 준다 (타일 단위) */
const FIT_MAX = { width: 20, height: 16 };

/**
 * 화면 배율. 도트가 뭉개지지 않게 항상 정수다.
 * 작은 맵(모닥불 캠프)은 맵 전체가 패널에 들어오는 가장 큰 배율, 넓은 맵(분수 광장)은 기본 배율(좁으면 낮춤).
 */
export function zoomFor(layout: MapLayout, width: number, height: number): number {
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
