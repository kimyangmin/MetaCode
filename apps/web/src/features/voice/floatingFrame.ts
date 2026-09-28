/** 떠 있는 창의 위치와 크기 (화면 픽셀) */
export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 크기를 바꾸는 가장자리: n(위) s(아래) e(오른쪽) w(왼쪽)와 그 조합(모서리) */
export type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const MIN_SIZE = { w: 320, h: 200 };
const MARGIN = 8;

/** 창이 화면 밖으로 나가지 않게 한다. 머리글이 늘 보이도록 위쪽은 화면 안에 둔다 */
export function clampFrame(frame: Frame, view: { width: number; height: number }): Frame {
  const w = Math.min(Math.max(frame.w, MIN_SIZE.w), view.width - MARGIN * 2);
  const h = Math.min(Math.max(frame.h, MIN_SIZE.h), view.height - MARGIN * 2);
  return {
    w,
    h,
    x: Math.min(Math.max(frame.x, MARGIN), view.width - w - MARGIN),
    y: Math.min(Math.max(frame.y, MARGIN), view.height - h - MARGIN),
  };
}

/** 처음 열 때: 화면 가운데에 크게 */
export function defaultFrame(view: { width: number; height: number }): Frame {
  const w = Math.round(view.width * 0.7);
  const h = Math.round(view.height * 0.7);
  return clampFrame({ x: (view.width - w) / 2, y: (view.height - h) / 2, w, h }, view);
}

/** 가장자리를 (dx, dy)만큼 끌었을 때의 창. 최소 크기보다 작아지면 반대쪽은 움직이지 않는다 */
export function resizeFrame(start: Frame, edge: Edge, dx: number, dy: number): Frame {
  let { x, y, w, h } = start;
  if (edge.includes('e')) w = Math.max(MIN_SIZE.w, start.w + dx);
  if (edge.includes('s')) h = Math.max(MIN_SIZE.h, start.h + dy);
  if (edge.includes('w')) {
    w = Math.max(MIN_SIZE.w, start.w - dx);
    x = start.x + start.w - w;
  }
  if (edge.includes('n')) {
    h = Math.max(MIN_SIZE.h, start.h - dy);
    y = start.y + start.h - h;
  }
  return { x, y, w, h };
}

const STORAGE_KEY = 'metacode:screen-viewer-frame';

export function readFrame(): Frame | null {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Frame | null;
    return value && [value.x, value.y, value.w, value.h].every(Number.isFinite) ? value : null;
  } catch {
    return null;
  }
}

export function saveFrame(frame: Frame): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(frame));
  } catch {
    // 기억하지 못해도 지금 창에는 적용된다.
  }
}
