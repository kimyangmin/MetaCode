import { MAP_LAYOUTS, PlazaMap, TILE_SIZE, isValidMove, isWalkable } from '@metacode/shared';
import { describe, expect, it } from 'vitest';
import { findPath, tileCenter } from './pathfinding';

const square = MAP_LAYOUTS[PlazaMap.FountainSquare];
const fountain = square.obstacles.find((o) => o.kind === 'fountain')!;

describe('findPath', () => {
  it('분수를 돌아서 반대편까지 가는 길을 찾고, 모든 칸에 설 수 있다', () => {
    const from = tileCenter(fountain.x - 2, fountain.y + 2);
    const to = tileCenter(fountain.x + fountain.w + 1, fountain.y + 2);
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
    const center = tileCenter(fountain.x + 2, fountain.y + 2);
    const path = findPath(square, tileCenter(fountain.x - 3, fountain.y + 2), center);
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
