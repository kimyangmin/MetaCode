import {
  GRAVITY,
  JUMP_SPEED,
  MAX_FALL_SPEED,
  MOVE_SPEED,
  type MapLayout,
  type Position,
  TILE_SIZE,
  isOnPlatform,
  isWalkable,
} from '@metacode/shared';

/** 한 프레임에 움직일 수 있는 최대 시간 (motion.ts와 같다) */
const MAX_FRAME_MS = 50;
/** 점프 키를 일찍 떼면 오르는 속도를 이만큼으로 줄여 낮게 뛴다 */
const JUMP_CUT = 0.45;

/** 횡스크롤 캐릭터: 발밑 가운데 위치와 세로 속도 (px/초, 아래가 +) */
export interface SideBody extends Position {
  vy: number;
  grounded: boolean;
  /** 아래(↓)를 눌러 내려가는 중인 발판의 윗변. 그 발판은 지나갈 때까지 딛지 않는다 */
  dropFrom: number | null;
}

export interface SideInput {
  /** -1 왼쪽, 0, 1 오른쪽 */
  dx: number;
  /** 이번 프레임에 점프를 눌렀다 */
  jump: boolean;
  /** 점프 키를 누르고 있다. 오르는 중에 떼면 낮게 뛴다 */
  jumpHeld: boolean;
  /** 이번 프레임에 아래를 눌렀다: 발판 위면 그 발판 아래로 내려간다 */
  drop: boolean;
}

const sameEdge = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 0.5;

/** 서 있는지: 막힌 칸·맵 바닥 위, 또는 (내려가는 중이 아닌) 발판 위 */
function standing(layout: MapLayout, x: number, y: number, dropFrom: number | null): boolean {
  if (!isWalkable(layout, x, y)) return false;
  if (!isWalkable(layout, x, y + 1)) return true;
  return isOnPlatform(layout, x, y) && !sameEdge(dropFrom, y);
}

/** 서 있으면 발을 칸 경계에 딱 맞춘다 (경계와 1px 안쪽으로 어긋나 떠 있거나 묻힌 것을 바로잡는다) */
function settle(layout: MapLayout, x: number, y: number): number {
  const edge = Math.round(y / TILE_SIZE) * TILE_SIZE;
  if (edge === y || Math.abs(edge - y) >= 1) return y;
  return isWalkable(layout, x, edge) ? edge : y;
}

export function createSideBody(layout: MapLayout, position: Position): SideBody {
  return {
    ...position,
    vy: 0,
    grounded: standing(layout, position.x, position.y, null),
    dropFrom: null,
  };
}

/** 가로로 최대 amount만큼, 막히기 직전까지 (1px씩 줄여 가며 확인) */
function slideX(layout: MapLayout, x: number, y: number, amount: number): number {
  const sign = Math.sign(amount);
  for (let d = Math.abs(amount); d > 0; d = Math.max(0, d - 1)) {
    if (isWalkable(layout, x + sign * d, y)) return x + sign * d;
    if (d <= 1) break;
  }
  return x;
}

/**
 * 세로로 dy만큼 1px씩 움직인다 (빨리 떨어져도 얇은 발판·땅을 뚫지 않게). 막힌 칸에 닿거나, 내려가다가
 * 발판의 윗변을 지나면 거기서 멈춘다(hit). 땅에 닿으면 칸 경계에 딱 맞춰 세운다.
 */
function moveY(
  layout: MapLayout,
  x: number,
  y: number,
  dy: number,
  dropFrom: number | null,
): { y: number; hit: boolean } {
  const sign = Math.sign(dy);
  let remaining = Math.abs(dy);
  let current = y;
  while (remaining > 1e-9) {
    const next = current + sign * Math.min(1, remaining);
    if (!isWalkable(layout, x, next)) {
      if (sign > 0) {
        const snap = Math.ceil(current);
        if (snap > current && snap < next && isWalkable(layout, x, snap)) current = snap;
      }
      return { y: current, hit: true };
    }
    if (sign > 0) {
      const edge = Math.floor(next / TILE_SIZE) * TILE_SIZE;
      if (
        edge >= current &&
        edge < next &&
        !sameEdge(dropFrom, edge) &&
        isOnPlatform(layout, x, edge)
      ) {
        return { y: edge, hit: true };
      }
    }
    current = next;
    remaining -= Math.min(1, remaining);
  }
  return { y: current, hit: false };
}

/**
 * 횡스크롤 한 프레임: 좌우로 걷고, 서 있으면 점프하고, 공중이면 중력으로 떨어진다.
 * 발판은 위에서 내려올 때만 딛고(아래에서 뛰면 지나간다), 아래를 누르면 발판 아래로 내려간다.
 */
export function stepSide(
  layout: MapLayout,
  body: SideBody,
  input: SideInput,
  elapsedMs: number,
): SideBody {
  const dt = Math.min(Math.max(elapsedMs, 0), MAX_FRAME_MS) / 1000;
  let { x, y, vy, dropFrom } = body;
  if (input.dx !== 0) x = slideX(layout, x, y, input.dx * MOVE_SPEED * dt);

  let grounded = standing(layout, x, y, dropFrom);
  if (input.drop && grounded && isOnPlatform(layout, x, y) && isWalkable(layout, x, y + 1)) {
    dropFrom = y;
    grounded = false;
  }
  if (input.jump && grounded) {
    vy = -JUMP_SPEED;
    grounded = false;
  }
  if (!input.jumpHeld && vy < -JUMP_SPEED * JUMP_CUT) vy = -JUMP_SPEED * JUMP_CUT;

  if (grounded) {
    vy = 0;
  } else {
    vy = Math.min(vy + GRAVITY * dt, MAX_FALL_SPEED);
    const moved = moveY(layout, x, y, vy * dt, dropFrom);
    y = moved.y;
    if (moved.hit) vy = 0;
  }
  // 발판을 다 지나 내려왔으면 다시 딛는다.
  if (dropFrom !== null && y > dropFrom + 2) dropFrom = null;
  grounded = standing(layout, x, y, dropFrom);
  if (grounded) y = settle(layout, x, y);
  return { x, y, vy: grounded ? Math.min(vy, 0) : vy, grounded, dropFrom };
}
