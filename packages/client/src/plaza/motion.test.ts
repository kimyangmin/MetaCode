import {
  Cell,
  type MapLayout,
  MOVE_SPEED,
  PlazaMap,
  TILE_SIZE,
  isValidMove,
  isWalkable,
} from '@metacode/shared';
import { BUILTIN_LAYOUTS } from '@metacode/shared/builtin-assets';
import { describe, expect, it } from 'vitest';
import {
  CORNER_NUDGE_PX,
  INTERPOLATION_DELAY_MS,
  RemoteTrack,
  directionOf,
  stepByInput,
  stepToward,
} from './motion.js';
import { tileCenter } from './pathfinding.js';

const square = BUILTIN_LAYOUTS[PlazaMap.FountainSquare];

describe('stepByInput', () => {
  it('속도만큼 움직이고, 대각선도 같은 속도다', () => {
    const from = tileCenter(10, 12);
    const right = stepByInput(square, from, 1, 0, 50);
    expect(right.x - from.x).toBeCloseTo((MOVE_SPEED * 50) / 1000);

    const diagonal = stepByInput(square, from, 1, 1, 50);
    expect(Math.hypot(diagonal.x - from.x, diagonal.y - from.y)).toBeCloseTo(
      (MOVE_SPEED * 50) / 1000,
    );
  });

  it('벽 앞에서 멈추고, 비스듬히 부딪히면 벽을 따라 미끄러진다', () => {
    let position = tileCenter(2, 10);
    for (let i = 0; i < 40; i++) position = stepByInput(square, position, -1, 1, 16);
    expect(isWalkable(square, position.x, position.y)).toBe(true);
    // 왼쪽은 벽이라 더 못 가지만 아래로는 계속 갔다.
    expect(position.x).toBeLessThan(tileCenter(2, 10).x);
    expect(position.y).toBeGreaterThan(tileCenter(2, 10).y + 40);
    expect(stepByInput(square, position, -1, 0, 16).x).toBe(position.x);
  });

  it('모서리에 살짝 걸리면 옆으로 비켜 지나가고, 한가운데로 가면 막힌다', () => {
    // 10×10 맵 가운데 (5, 5) 한 칸만 막힘
    const blocked = new Uint8Array(100);
    blocked[5 * 10 + 5] = Cell.Solid;
    const layout: MapLayout = { width: 10, height: 10, blocked, spawn: { x: 0, y: 0, w: 1, h: 1 } };
    const top = 5 * TILE_SIZE;
    // 발(6px 높이)의 아래 2px가 막힌 칸의 윗줄에 걸쳐 있다
    let position = { x: top - 6, y: top + 2 };
    for (let i = 0; i < 30; i++) position = stepByInput(layout, position, 1, 0, 16);
    expect(position.x).toBeGreaterThan(6 * TILE_SIZE + 5);
    // 위로 비켜선 거리는 필요한 만큼(2px)에서 1px 안쪽
    expect(position.y).toBeLessThanOrEqual(top);
    expect(position.y).toBeGreaterThanOrEqual(top - 1);

    // 한가운데로 걸어가면 비켜 줄 거리(CORNER_NUDGE_PX)보다 멀어서 그대로 막힌다
    const middle = { x: top - 5, y: top + 11 };
    expect(top + 11 - top).toBeGreaterThan(CORNER_NUDGE_PX);
    expect(stepByInput(layout, middle, 1, 0, 16)).toEqual(middle);
  });

  it('프레임이 길어도 한 번에 멀리 가지 않아서 서버 검사를 통과한다', () => {
    const from = tileCenter(10, 12);
    const to = stepByInput(square, from, 1, 0, 2_000);
    expect(isValidMove(square, from, to, 100)).toBe(true);
  });

  it('방향: 대각선이면 좌우, 멈추면 이전 방향', () => {
    expect(directionOf(-1, 1, 'down')).toBe('left');
    expect(directionOf(0, -1, 'down')).toBe('up');
    expect(directionOf(0, 0, 'right')).toBe('right');
  });
});

describe('stepToward', () => {
  it('목표까지 가면 도착했다고 알린다', () => {
    const from = tileCenter(10, 12);
    const target = tileCenter(11, 12);
    let step = stepToward(square, from, target, 50)!;
    expect(step.arrived).toBe(false);
    for (let i = 0; i < 10 && !step.arrived; i++)
      step = stepToward(square, step.position, target, 50)!;
    expect(step).toEqual({ position: target, arrived: true });
  });

  it('가는 길이 막혀 있으면 null', () => {
    expect(stepToward(square, tileCenter(1, 10), tileCenter(0, 10), 50)).toBeNull();
  });
});

describe('RemoteTrack', () => {
  it('받은 두 위치 사이를 지연 시간만큼 늦게 보간한다', () => {
    const track = new RemoteTrack({ x: 0, y: 0 }, 1_000);
    track.push({ x: 10, y: 0 }, 1_100);
    expect(track.at(1_000 + INTERPOLATION_DELAY_MS).x).toBe(0);
    expect(track.at(1_050 + INTERPOLATION_DELAY_MS).x).toBeCloseTo(5);
    expect(track.at(1_100 + INTERPOLATION_DELAY_MS).x).toBe(10);
  });

  it('새 위치가 끊기면 마지막 위치에 멈춘다', () => {
    const track = new RemoteTrack({ x: 0, y: 0 }, 0);
    track.push({ x: 10, y: 0 }, 100);
    expect(track.at(5_000)).toEqual({ x: 10, y: 0 });
  });

  it('멀리 떨어진 위치(되돌림)는 보간하지 않고 바로 옮긴다', () => {
    const track = new RemoteTrack({ x: 0, y: 0 }, 0);
    track.push({ x: 300, y: 0 }, 100);
    expect(track.at(101)).toEqual({ x: 300, y: 0 });
  });
});
