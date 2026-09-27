import { describe, expect, it } from 'vitest';
import { PlazaMap } from '../domain/plaza.js';
import { MAP_LAYOUTS, TILE_SIZE } from './layout.js';
import { MOVE_SPEED, isValidMove, isWalkable, spawnPosition } from './movement.js';

const square = MAP_LAYOUTS[PlazaMap.FountainSquare];
const camp = MAP_LAYOUTS[PlazaMap.Campfire];
/** 타일 (tx, ty)의 발밑 가운데 좌표 */
const at = (tx: number, ty: number) => ({ x: tx * TILE_SIZE + 8, y: ty * TILE_SIZE + 15 });

describe('isWalkable', () => {
  it('빈 땅은 설 수 있고, 벽·분수·맵 밖은 설 수 없다', () => {
    expect(isWalkable(square, at(10, 10).x, at(10, 10).y)).toBe(true);
    expect(isWalkable(square, at(0, 10).x, at(0, 10).y)).toBe(false); // 가장자리 벽
    expect(isWalkable(square, at(23, 17).x, at(23, 17).y)).toBe(false); // 분수
    expect(isWalkable(square, -5, 100)).toBe(false);
    expect(isWalkable(square, 100, square.height * TILE_SIZE + 5)).toBe(false);
  });

  it('길(장식)은 막지 않는다', () => {
    expect(isWalkable(square, at(23, 3).x, at(23, 3).y)).toBe(true);
  });
});

describe('isValidMove', () => {
  const from = at(10, 10);

  it('속도 안의 이동은 받아들인다', () => {
    const step = (MOVE_SPEED * 100) / 1000; // 100ms 동안 갈 수 있는 거리
    expect(isValidMove(square, from, { x: from.x + step, y: from.y }, 100)).toBe(true);
  });

  it('너무 멀리 한 번에 가는 것(순간이동)은 거절한다', () => {
    expect(isValidMove(square, from, { x: from.x + 200, y: from.y }, 100)).toBe(false);
  });

  it('오래 멈췄다가 보내도 한 번에 갈 수 있는 거리는 늘지 않는다', () => {
    expect(isValidMove(square, from, { x: from.x + 300, y: from.y }, 60_000)).toBe(false);
  });

  it('장애물로 들어가거나 가로질러 가는 것은 거절한다', () => {
    const nearFountain = at(20, 17);
    expect(isValidMove(square, nearFountain, at(21, 17), 200)).toBe(false);
    // 1칸짜리 벤치를 한 번에 넘어가기
    const aboveBench = { x: at(15, 9).x, y: at(15, 9).y };
    const belowBench = { x: aboveBench.x, y: aboveBench.y + 2 * TILE_SIZE };
    expect(isValidMove(square, aboveBench, belowBench, 500)).toBe(false);
  });

  it('숫자가 아닌 좌표는 거절한다', () => {
    expect(isValidMove(square, from, { x: Number.NaN, y: from.y }, 100)).toBe(false);
  });
});

describe('spawnPosition', () => {
  it('같은 사람은 같은 자리, 스폰 영역 안의 설 수 있는 칸', () => {
    for (const layout of [square, camp]) {
      const a = spawnPosition(layout, 'user-a');
      expect(spawnPosition(layout, 'user-a')).toEqual(a);
      expect(isWalkable(layout, a.x, a.y)).toBe(true);
      const tx = Math.floor(a.x / TILE_SIZE);
      const ty = Math.floor(a.y / TILE_SIZE);
      expect(tx).toBeGreaterThanOrEqual(layout.spawn.x);
      expect(tx).toBeLessThan(layout.spawn.x + layout.spawn.w);
      expect(ty).toBeGreaterThanOrEqual(layout.spawn.y);
      expect(ty).toBeLessThan(layout.spawn.y + layout.spawn.h);
    }
  });

  it('여러 사람이 흩어져서 나타난다', () => {
    const positions = new Set(
      Array.from({ length: 20 }, (_, i) => JSON.stringify(spawnPosition(square, `user-${i}`))),
    );
    expect(positions.size).toBeGreaterThan(10);
  });
});
