export type PanelKey = 'chat' | 'plaza';
export type Edge = 'left' | 'right' | 'top' | 'bottom';

/** 두 패널의 배치: 가로(좌우) 또는 세로(위아래), 앞(왼쪽·위)에 오는 패널 */
export interface Arrangement {
  orientation: 'horizontal' | 'vertical';
  first: PanelKey;
}

export const DEFAULT_ARRANGEMENT: Arrangement = { orientation: 'horizontal', first: 'chat' };

export const otherPanel = (key: PanelKey): PanelKey => (key === 'chat' ? 'plaza' : 'chat');

/** 영역 안의 점에서 가장 가까운 가장자리 (영역 크기에 비례해서 잰다) */
export function edgeAt(
  rect: { left: number; top: number; width: number; height: number },
  x: number,
  y: number,
): Edge {
  const fx = (x - rect.left) / rect.width;
  const fy = (y - rect.top) / rect.height;
  const distances: [Edge, number][] = [
    ['left', fx],
    ['right', 1 - fx],
    ['top', fy],
    ['bottom', 1 - fy],
  ];
  return distances.reduce((best, current) => (current[1] < best[1] ? current : best))[0];
}

/** 끈 패널을 그 가장자리에 놓았을 때의 배치 */
export function arrangementFor(dragged: PanelKey, edge: Edge): Arrangement {
  const orientation = edge === 'left' || edge === 'right' ? 'horizontal' : 'vertical';
  const first = edge === 'left' || edge === 'top' ? dragged : otherPanel(dragged);
  return { orientation, first };
}

/** 드래그를 끝낸 곳이 창 밖인지 (화면 좌표) */
export function isOutsideWindow(
  screen: { x: number; y: number },
  win: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    screen.x < win.x ||
    screen.y < win.y ||
    screen.x > win.x + win.width ||
    screen.y > win.y + win.height
  );
}
