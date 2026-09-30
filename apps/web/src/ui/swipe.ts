/** 이만큼 움직일 때까지는 가로로 미는지 세로로 스크롤하는지 정하지 않는다 (px) */
const DECIDE_DISTANCE = 10;

/** 손가락이 처음 움직인 방향: 가로면 밀기, 세로면 스크롤로 보고 그만 본다. 아직 모르면 null */
export function gestureAxis(dx: number, dy: number): 'x' | 'y' | null {
  if (Math.abs(dx) < DECIDE_DISTANCE && Math.abs(dy) < DECIDE_DISTANCE) return null;
  return Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
}

/**
 * 누른 곳부터 root까지 가로로 스크롤되는 요소가 있는지 (긴 코드 블록 등).
 * 그런 곳의 가로 밀기는 스크롤로 두고 서랍·답장 밀기로 쓰지 않는다.
 */
export function inHorizontalScroller(target: Element, root: Element): boolean {
  for (let el: Element | null = target; el && el !== root; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1) {
      const { overflowX } = getComputedStyle(el);
      if (overflowX === 'auto' || overflowX === 'scroll') return true;
    }
  }
  return false;
}

/** 글을 쓰는 곳에서의 가로 밀기는 커서 옮기기·글 고르기로 둔다 */
export const TEXT_INPUT_SELECTOR = 'input, textarea, select, [contenteditable="true"]';
