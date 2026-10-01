import { describe, expect, it } from 'vitest';
import { BUILTIN_LAYOUTS } from '../assets/builtin.js';
import { PlazaMap } from '../domain/plaza.js';
import { TILE_SIZE } from './layout.js';
import {
  MOVE_SPEED,
  isClearPath,
  isValidMove,
  isWalkable,
  moveCostMs,
  nearestWalkable,
  spawnPosition,
} from './movement.js';
import { Cell, type MapLayout } from './layout.js';

const square = BUILTIN_LAYOUTS[PlazaMap.FountainSquare];
const camp = BUILTIN_LAYOUTS[PlazaMap.Campfire];
/** 타일 (tx, ty)의 발밑 가운데 좌표 */
const at = (tx: number, ty: number) => ({ x: tx * TILE_SIZE + 8, y: ty * TILE_SIZE + 15 });

describe('isWalkable', () => {
  it('빈 땅은 설 수 있고, 가장자리 숲·분수·맵 밖은 설 수 없다', () => {
    expect(isWalkable(square, at(10, 10).x, at(10, 10).y)).toBe(true);
    expect(isWalkable(square, at(0, 10).x, at(0, 10).y)).toBe(false); // 가장자리 나무
    expect(isWalkable(square, at(23, 18).x, at(23, 18).y)).toBe(false); // 분수
    expect(isWalkable(square, -5, 100)).toBe(false);
    expect(isWalkable(square, 100, square.height * TILE_SIZE + 5)).toBe(false);
  });

  it('돌길은 막지 않는다', () => {
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
    const nearFountain = at(21, 18);
    expect(isValidMove(square, nearFountain, at(22, 18), 200)).toBe(false);
    // 벤치(아래 한 줄이 막힘)를 한 번에 넘어가기
    const aboveBench = { x: at(15, 11).x, y: at(15, 11).y };
    const belowBench = { x: aboveBench.x, y: aboveBench.y + 2 * TILE_SIZE };
    expect(isValidMove(square, aboveBench, belowBench, 500)).toBe(false);
  });

  it('시간을 앞당겨 썼으면(elapsed가 음수) 움직일 수 없다', () => {
    expect(isValidMove(square, from, { x: from.x + 3, y: from.y }, -40)).toBe(false);
    expect(isValidMove(square, from, from, -40)).toBe(true);
    expect(moveCostMs(from, { x: from.x + 9.6, y: from.y })).toBeCloseTo(66.7, 0);
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

describe('isClearPath', () => {
  // 10×10 맵 가운데 (5, 5) 한 칸만 막힘
  const blocked = new Uint8Array(100);
  blocked[5 * 10 + 5] = Cell.Solid;
  const one: MapLayout = { width: 10, height: 10, blocked, spawn: { x: 0, y: 0, w: 1, h: 1 } };
  const T = TILE_SIZE;

  it('곧은 선이 모서리를 스쳐도, 꺾어 가는 길이 열려 있으면 지나간다', () => {
    // 막힌 칸의 왼쪽에서 발이 칸 윗줄에 걸쳐 있다가, 위로 비켜서 칸 위를 지나간 것
    const from = { x: 5 * T - 6, y: 5 * T + 6 };
    const to = { x: 5 * T + 6, y: 5 * T - 1 };
    expect(isWalkable(one, from.x, from.y) && isWalkable(one, to.x, to.y)).toBe(true);
    expect(isClearPath(one, from, to)).toBe(true);
  });

  it('막힌 칸을 가로지르면 어느 쪽으로 꺾어도 막힌다', () => {
    expect(
      isClearPath(one, { x: 4 * T + 6, y: 5 * T + 10 }, { x: 6 * T + 10, y: 5 * T + 10 }),
    ).toBe(false);
  });
});

describe('nearestWalkable', () => {
  it('설 수 있으면 그대로, 장애물 속이면 가까운 설 수 있는 칸', () => {
    const open = at(10, 10);
    expect(nearestWalkable(square, open)).toEqual(open);
    const fountain = at(23, 18);
    const fixed = nearestWalkable(square, fountain)!;
    expect(isWalkable(square, fixed.x, fixed.y)).toBe(true);
    expect(Math.hypot(fixed.x - fountain.x, fixed.y - fountain.y)).toBeLessThan(5 * TILE_SIZE);
  });
});
