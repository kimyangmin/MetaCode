/** 이만큼 넘게 끌어내리면 닫는다 (px) */
export const SHEET_CLOSE_DISTANCE = 80;
/** 짧게 끌어도 이보다 빠르게 내리면 닫는다 (px/ms) */
export const SHEET_FLICK_SPEED = 0.5;
/** 빠르게 내린 것으로 보려면 적어도 이만큼은 끌어야 한다 (톡 건드린 것과 구분, px) */
const FLICK_MIN_DISTANCE = 16;

/** 시트를 끌어내린 거리. 위로 끈 것은 0이다 (시트가 위로 더 올라가지 않게) */
export function sheetDragOffset(dy: number): number {
  return Math.max(0, dy);
}

/** 손을 뗐을 때 닫을지: 충분히 내렸거나, 빠르게 툭 내렸으면 닫는다 */
export function shouldCloseSheet(offset: number, elapsedMs: number): boolean {
  if (offset >= SHEET_CLOSE_DISTANCE) return true;
  return offset >= FLICK_MIN_DISTANCE && offset / Math.max(1, elapsedMs) >= SHEET_FLICK_SPEED;
}
