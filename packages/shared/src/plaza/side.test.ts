import { describe, expect, it } from 'vitest';
import { Cell, type MapLayout, TILE_SIZE } from './layout.js';
import {
  groundBelow,
  isGrounded,
  isOnPlatform,
  isWalkable,
  nearestWalkable,
  spawnPosition,
} from './movement.js';
import {
  JUMP_HEIGHT,
  JUMP_SPEED,
  MAX_FALL_SPEED,
  isValidSideMove,
  sideMoveCostMs,
} from './side.js';

const W = 20;
const H = 12;
const T = TILE_SIZE;

/** 맨 아래 두 줄이 땅, 6~9열 8번 줄에 발판, 14열 9~10번 줄에 벽 */
function layout(): MapLayout {
  const blocked = new Uint8Array(W * H);
  for (let x = 0; x < W; x++) {
    blocked[(H - 1) * W + x] = Cell.Solid;
    blocked[(H - 2) * W + x] = Cell.Solid;
  }
  for (let x = 6; x <= 9; x++) blocked[8 * W + x] = Cell.Platform;
  blocked[9 * W + 14] = Cell.Solid;
  return { width: W, height: H, blocked, spawn: { x: 2, y: 2, w: 3, h: 2 }, style: 'SIDE_SCROLL' };
}

const side = layout();
/** 땅 윗면 (10번 줄의 위) */
const FLOOR = (H - 2) * T;

describe('횡스크롤 충돌', () => {
  it('몸 전체가 부딪힌다: 머리가 벽에 걸리면 설 수 없다', () => {
    // 14열 9번 줄의 벽: 발은 땅 위(10번 줄 위)지만 몸이 벽과 겹친다
    expect(isWalkable(side, 14 * T + 8, FLOOR)).toBe(false);
    expect(isWalkable(side, 12 * T + 8, FLOOR)).toBe(true);
  });

  it('발판은 몸을 막지 않는다 (아래에서 뛰어 지나간다)', () => {
    expect(isWalkable(side, 7 * T + 8, 8 * T + 10)).toBe(true);
  });

  it('땅과 발판 위, 맵 바닥은 서 있는 것이다', () => {
    expect(isGrounded(side, 3 * T, FLOOR)).toBe(true);
    expect(isGrounded(side, 3 * T, FLOOR - 5)).toBe(false);
    expect(isOnPlatform(side, 7 * T + 8, 8 * T)).toBe(true);
    expect(isGrounded(side, 7 * T + 8, 8 * T)).toBe(true);
    expect(isGrounded(side, 7 * T + 8, 8 * T + 3)).toBe(false);
  });

  it('groundBelow: 아래로 떨어지면 닿는 곳', () => {
    expect(groundBelow(side, 3 * T, 2 * T)).toBe(FLOOR);
    expect(groundBelow(side, 7 * T + 8, 3 * T)).toBe(8 * T); // 발판
    expect(groundBelow(side, 7 * T + 8, 8 * T + 4)).toBe(FLOOR); // 발판 아래에서 떨어짐
    expect(groundBelow(side, 3 * T, FLOOR)).toBe(FLOOR);
  });

  it('스폰 자리는 땅 위다', () => {
    const p = spawnPosition(side, 'user');
    expect(p.y).toBe(FLOOR);
    expect(isGrounded(side, p.x, p.y)).toBe(true);
  });
});

describe('isValidSideMove', () => {
  const from = { x: 3 * T, y: FLOOR };

  it('걷기, 점프, 떨어지기는 받아들인다', () => {
    expect(isValidSideMove(side, from, { x: from.x + 9, y: from.y }, 100, FLOOR)).toBe(true);
    const rise = (JUMP_SPEED * 100) / 1000;
    expect(isValidSideMove(side, from, { x: from.x, y: from.y - rise }, 100, FLOOR)).toBe(true);
    const air = { x: from.x, y: FLOOR - JUMP_HEIGHT };
    const fall = (MAX_FALL_SPEED * 100) / 1000;
    expect(isValidSideMove(side, air, { x: air.x, y: air.y + fall }, 100, FLOOR)).toBe(true);
  });

  it('점프 높이보다 높이 오르면(날기) 거절한다', () => {
    const high = { x: from.x, y: FLOOR - JUMP_HEIGHT + 2 };
    expect(isValidSideMove(side, high, { x: high.x, y: high.y - 20 }, 200, FLOOR)).toBe(false);
  });

  it('너무 빠르거나 벽을 뚫으면 거절한다', () => {
    expect(isValidSideMove(side, from, { x: from.x + 80, y: from.y }, 100, FLOOR)).toBe(false);
    expect(isValidSideMove(side, from, { x: from.x, y: from.y - 120 }, 100, FLOOR)).toBe(false);
    const nearWall = { x: 13 * T + 8, y: FLOOR };
    expect(isValidSideMove(side, nearWall, { x: 15 * T + 8, y: FLOOR }, 400, FLOOR)).toBe(false);
  });

  it('턱에 붙어 뛰어오른 뒤 올라서는 것은 받아들인다 (곧은 선은 턱 모서리를 스침)', () => {
    // 14열 벽(한 칸 높이)의 왼쪽에 몸을 붙이고 뛰어오르는 중 → 벽 위에 올라섬
    const against = { x: 14 * T - 4, y: FLOOR - 10 };
    const onTop = { x: 14 * T + 1, y: 9 * T };
    expect(isValidSideMove(side, against, onTop, 50, FLOOR)).toBe(true);
    // 벽을 그대로 뚫고 지나가는 것은 꺾어 가도 막혀 있다
    expect(isValidSideMove(side, against, { x: 15 * T + 4, y: FLOOR - 10 }, 200, FLOOR)).toBe(
      false,
    );
  });

  it('시간을 앞당겨 썼으면(elapsed가 음수) 움직일 수 없고, 제자리는 괜찮다', () => {
    expect(isValidSideMove(side, from, { x: from.x + 3, y: from.y }, -40, FLOOR)).toBe(false);
    expect(isValidSideMove(side, from, from, -40, FLOOR)).toBe(true);
  });

  it('이동 시간은 가로·세로 중 더 오래 걸리는 쪽', () => {
    expect(sideMoveCostMs(from, { x: from.x + 9.6, y: from.y })).toBeCloseTo(66.7, 0);
    expect(sideMoveCostMs(from, { x: from.x, y: from.y - JUMP_SPEED / 10 })).toBeCloseTo(66.7, 0);
  });
});

describe('nearestWalkable (횡스크롤)', () => {
  it('벽 속에 남은 자리는 가까운 땅 위로 옮긴다', () => {
    const inWall = { x: 14 * T + 8, y: FLOOR };
    expect(isWalkable(side, inWall.x, inWall.y)).toBe(false);
    const fixed = nearestWalkable(side, inWall)!;
    expect(isGrounded(side, fixed.x, fixed.y)).toBe(true);
    expect(Math.abs(fixed.x - inWall.x)).toBeLessThanOrEqual(T);
  });
});
