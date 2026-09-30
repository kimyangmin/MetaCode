import { Cell, JUMP_HEIGHT, type MapLayout, TILE_SIZE, isValidSideMove } from '@metacode/shared';
import { describe, expect, it } from 'vitest';
import { type SideBody, type SideInput, createSideBody, stepSide } from './sideMotion.js';

const W = 20;
const H = 12;
const T = TILE_SIZE;
const FLOOR = (H - 2) * T;

/** 맨 아래 두 줄이 땅, 6~9열 7번 줄에 발판(땅에서 세 칸 위), 14열 9번 줄에 한 칸 턱 */
function layout(): MapLayout {
  const blocked = new Uint8Array(W * H);
  for (let x = 0; x < W; x++) {
    blocked[(H - 1) * W + x] = Cell.Solid;
    blocked[(H - 2) * W + x] = Cell.Solid;
  }
  for (let x = 6; x <= 9; x++) blocked[7 * W + x] = Cell.Platform;
  blocked[9 * W + 14] = Cell.Solid;
  return { width: W, height: H, blocked, spawn: { x: 1, y: 1, w: 2, h: 2 }, style: 'SIDE_SCROLL' };
}

const side = layout();
const idle: SideInput = { dx: 0, jump: false, jumpHeld: false, drop: false };

/** 16ms씩 frames번 움직인다 */
function run(
  body: SideBody,
  input: Partial<SideInput>,
  frames: number,
  first?: Partial<SideInput>,
) {
  let current = body;
  for (let i = 0; i < frames; i++) {
    current = stepSide(side, current, { ...idle, ...input, ...(i === 0 ? first : {}) }, 16);
  }
  return current;
}

describe('stepSide', () => {
  it('공중에서는 떨어져서 땅 위(칸 경계)에 선다', () => {
    const body = run(createSideBody(side, { x: 3 * T, y: 3 * T }), {}, 120);
    expect(body.y).toBe(FLOOR);
    expect(body.grounded).toBe(true);
    expect(body.vy).toBe(0);
  });

  it('서 있으면 뛰어오르고, 점프 높이만큼만 오른다', () => {
    let body = createSideBody(side, { x: 3 * T, y: FLOOR });
    let highest = body.y;
    body = stepSide(side, body, { ...idle, jump: true, jumpHeld: true }, 16);
    for (let i = 0; i < 80; i++) {
      body = stepSide(side, body, { ...idle, jumpHeld: true }, 16);
      highest = Math.min(highest, body.y);
    }
    expect(FLOOR - highest).toBeGreaterThan(JUMP_HEIGHT - 4);
    expect(FLOOR - highest).toBeLessThanOrEqual(JUMP_HEIGHT + 1);
    expect(body.y).toBe(FLOOR);
  });

  it('점프 키를 일찍 떼면 낮게 뛴다', () => {
    let body = createSideBody(side, { x: 3 * T, y: FLOOR });
    body = stepSide(side, body, { ...idle, jump: true, jumpHeld: true }, 16);
    let highest = body.y;
    for (let i = 0; i < 60; i++) {
      body = stepSide(side, body, idle, 16);
      highest = Math.min(highest, body.y);
    }
    expect(FLOOR - highest).toBeLessThan(JUMP_HEIGHT / 2);
  });

  it('발판은 아래에서 뛰어 지나가고, 위에서 내려오면 딛는다. 아래를 누르면 내려간다', () => {
    // 발판 바로 아래에서 뛰면 발판을 지나 올라갔다가 발판 위에 내려앉는다
    let body = run(createSideBody(side, { x: 7 * T + 8, y: FLOOR }), { jumpHeld: true }, 90, {
      jump: true,
    });
    expect(body.y).toBe(7 * T);
    expect(body.grounded).toBe(true);
    body = run(body, {}, 90, { drop: true });
    expect(body.y).toBe(FLOOR);
  });

  it('한 칸 턱은 걸어서는 못 넘고 뛰어서 넘는다', () => {
    const start = createSideBody(side, { x: 12 * T, y: FLOOR });
    const blocked = run(start, { dx: 1 }, 60);
    expect(blocked.x).toBeLessThan(14 * T);
    const over = run(start, { dx: 1, jumpHeld: true }, 60, { jump: true });
    expect(over.x).toBeGreaterThan(14 * T);
  });

  it('움직인 결과를 서버 검증(isValidSideMove)이 받아들인다', () => {
    let body = createSideBody(side, { x: 3 * T, y: FLOOR });
    let sent = { x: body.x, y: body.y };
    let ground = FLOOR;
    body = stepSide(side, body, { ...idle, dx: 1, jump: true, jumpHeld: true }, 16);
    for (let frame = 1; frame <= 60; frame++) {
      body = stepSide(side, body, { ...idle, dx: 1, jumpHeld: true }, 16);
      if (frame % 6 === 0) {
        expect(isValidSideMove(side, sent, body, 96, ground)).toBe(true);
        sent = { x: body.x, y: body.y };
        if (body.grounded) ground = body.y;
      }
    }
  });
});
