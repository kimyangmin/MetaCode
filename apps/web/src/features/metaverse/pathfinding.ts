import { type MapLayout, type Position, TILE_SIZE, isWalkable } from '@metacode/shared';

/** 타일 한가운데의 발밑 좌표 (px) */
export const tileCenter = (tx: number, ty: number): Position => ({
  x: tx * TILE_SIZE + TILE_SIZE / 2,
  y: ty * TILE_SIZE + TILE_SIZE - 1,
});

const toTile = (p: Position) => ({
  x: Math.floor(p.x / TILE_SIZE),
  y: Math.floor((p.y - 1) / TILE_SIZE),
});

const standable = (layout: MapLayout, tx: number, ty: number) => {
  const c = tileCenter(tx, ty);
  return isWalkable(layout, c.x, c.y);
};

/** 목표 칸에 설 수 없으면(분수 한가운데 등) 가장 가까운 설 수 있는 칸 */
function nearestStandable(layout: MapLayout, tx: number, ty: number) {
  let best: { x: number; y: number } | null = null;
  let bestDistance = Infinity;
  for (let dy = -6; dy <= 6; dy++) {
    for (let dx = -6; dx <= 6; dx++) {
      const distance = Math.hypot(dx, dy);
      if (distance < bestDistance && standable(layout, tx + dx, ty + dy)) {
        best = { x: tx + dx, y: ty + dy };
        bestDistance = distance;
      }
    }
  }
  return best;
}

const DIRS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
] as const;

/**
 * 마우스로 누른 곳까지 가는 길 (A*, 8방향). 대각선은 양옆이 모두 열려 있을 때만 간다
 * (모서리를 비스듬히 파고들지 않도록). 돌려주는 값은 거쳐 갈 타일 가운데 좌표이고, 출발 칸은 빠진다.
 * 갈 수 없으면 빈 배열.
 */
export function findPath(layout: MapLayout, from: Position, to: Position): Position[] {
  const start = toTile(from);
  const target = nearestStandable(layout, toTile(to).x, toTile(to).y);
  if (!target || (start.x === target.x && start.y === target.y)) return [];

  const width = layout.width;
  const key = (x: number, y: number) => y * width + x;
  const heuristic = (x: number, y: number) => Math.hypot(target.x - x, target.y - y);

  const g = new Map<number, number>([[key(start.x, start.y), 0]]);
  const cameFrom = new Map<number, number>();
  // 맵이 작아(최대 수천 칸) 정렬된 배열로 충분하다.
  const open: { k: number; x: number; y: number; f: number }[] = [
    { k: key(start.x, start.y), x: start.x, y: start.y, f: heuristic(start.x, start.y) },
  ];
  const closed = new Set<number>();

  while (open.length > 0) {
    open.sort((a, b) => a.f - b.f);
    const current = open.shift()!;
    if (current.x === target.x && current.y === target.y) {
      const path: Position[] = [];
      let k: number | undefined = current.k;
      while (k !== undefined && k !== key(start.x, start.y)) {
        path.unshift(tileCenter(k % width, Math.floor(k / width)));
        k = cameFrom.get(k);
      }
      return path;
    }
    closed.add(current.k);

    for (const [dx, dy, cost] of DIRS) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      const nk = key(nx, ny);
      if (closed.has(nk) || !standable(layout, nx, ny)) continue;
      if (dx !== 0 && dy !== 0) {
        if (
          !standable(layout, current.x + dx, current.y) ||
          !standable(layout, current.x, current.y + dy)
        ) {
          continue;
        }
      }
      const tentative = g.get(current.k)! + cost;
      if (tentative >= (g.get(nk) ?? Infinity)) continue;
      g.set(nk, tentative);
      cameFrom.set(nk, current.k);
      const existing = open.find((n) => n.k === nk);
      const f = tentative + heuristic(nx, ny);
      if (existing) existing.f = f;
      else open.push({ k: nk, x: nx, y: ny, f });
    }
  }
  return [];
}
