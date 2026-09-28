import { PlazaMap, TILE_SIZE, isValidMove, isWalkable } from '@metacode/shared';
import { BUILTIN_LAYOUTS, BUILTIN_MAPS } from '@metacode/shared/builtin-assets';
import { describe, expect, it } from 'vitest';
import { findPath, tileCenter } from './pathfinding';

const square = BUILTIN_LAYOUTS[PlazaMap.FountainSquare];
// 분수(3×4타일)는 놓은 칸(왼쪽 아래)과 그 위 한 줄이 막혀 있다.
const placed = BUILTIN_MAPS[PlazaMap.FountainSquare].objects.find(
  (o) => o.asset === 'builtin:fountain',
)!;
const fountain = { x: placed.x, y: placed.y - 1, w: 3 };

describe('findPath', () => {
  it('분수를 돌아서 반대편까지 가는 길을 찾고, 모든 칸에 설 수 있다', () => {
    const from = tileCenter(fountain.x - 2, fountain.y);
    const to = tileCenter(fountain.x + fountain.w + 1, fountain.y);
    const path = findPath(square, from, to);

    expect(path.length).toBeGreaterThan(fountain.w);
    expect(path.at(-1)).toEqual(to);
    for (const p of path) expect(isWalkable(square, p.x, p.y)).toBe(true);
  });

  it('이어지는 두 칸 사이도 벽을 지나지 않는다 (서버 이동 검사를 통과한다)', () => {
    const path = findPath(square, tileCenter(3, 10), tileCenter(40, 28));
    let previous = tileCenter(3, 10);
    for (const p of path) {
      // 한 칸(대각선 포함) 이동 = 최대 약 23px → 250ms면 충분하다.
      expect(isValidMove(square, previous, p, 250)).toBe(true);
      previous = p;
    }
  });

  it('누른 곳에 설 수 없으면(분수 한가운데) 가장 가까운 설 수 있는 칸으로 간다', () => {
    const center = tileCenter(fountain.x + 1, fountain.y);
    expect(isWalkable(square, center.x, center.y)).toBe(false);
    const path = findPath(square, tileCenter(fountain.x - 3, fountain.y), center);
    const last = path.at(-1)!;
    expect(isWalkable(square, last.x, last.y)).toBe(true);
    const distanceTiles = Math.hypot(last.x - center.x, last.y - center.y) / TILE_SIZE;
    expect(distanceTiles).toBeLessThan(4);
  });

  it('이미 도착해 있으면 빈 길', () => {
    const here = tileCenter(10, 10);
    expect(findPath(square, here, here)).toEqual([]);
  });
});
