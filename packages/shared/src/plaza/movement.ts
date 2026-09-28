import { type MapLayout, TILE_SIZE } from './layout.js';

/** 이동 속도 (px/초). 초당 6타일 */
export const MOVE_SPEED = 96;
/** 움직이는 동안 위치를 보내는 간격 */
export const MOVE_SEND_INTERVAL_MS = 100;

/**
 * 충돌 판정에 쓰는 발 영역 (px). 캐릭터 위치(x, y)는 발밑 가운데이고,
 * 16×32 캐릭터 중 발 부분만 부딪힌다 (머리는 장애물 앞을 지나갈 수 있다).
 */
export const FOOT = { width: 10, height: 6 } as const;

export type Direction = 'down' | 'up' | 'left' | 'right';

export interface Position {
  x: number;
  y: number;
}

/** 이 위치에 발을 둘 수 있는지 (맵 안이고 장애물 칸이 아닌지) */
export function isWalkable(layout: MapLayout, x: number, y: number): boolean {
  const left = x - FOOT.width / 2;
  const right = x + FOOT.width / 2 - 0.01;
  const top = y - FOOT.height;
  const bottom = y - 0.01;
  if (
    left < 0 ||
    top < 0 ||
    right >= layout.width * TILE_SIZE ||
    bottom >= layout.height * TILE_SIZE
  ) {
    return false;
  }
  for (const [px, py] of [
    [left, top],
    [right, top],
    [left, bottom],
    [right, bottom],
  ] as const) {
    const tx = Math.floor(px / TILE_SIZE);
    const ty = Math.floor(py / TILE_SIZE);
    if (layout.blocked[ty * layout.width + tx]) return false;
  }
  return true;
}

/** 이동을 한 번에 이만큼 이상 건너뛰었다고 보지 않는다 (오래 멈췄다가 순간이동하는 것 방지) */
const MAX_STEP_MS = 500;
/** 네트워크 지연과 프레임 차이를 감안한 여유 */
const SPEED_TOLERANCE = 1.5;
const DISTANCE_SLACK_PX = 4;

/**
 * 서버가 이동을 받아들일지. 클라이언트는 자기 캐릭터를 먼저 움직이고(예측) 주기적으로 위치를 보내므로,
 * 마지막으로 받아들인 위치에서 속도상 갈 수 있는 거리인지, 가는 길에 장애물이 없는지만 본다.
 */
export function isValidMove(
  layout: MapLayout,
  from: Position,
  to: Position,
  elapsedMs: number,
): boolean {
  if (!Number.isFinite(to.x) || !Number.isFinite(to.y)) return false;
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const allowed =
    (MOVE_SPEED * Math.min(Math.max(elapsedMs, 0), MAX_STEP_MS) * SPEED_TOLERANCE) / 1000 +
    DISTANCE_SLACK_PX;
  if (distance > allowed) return false;

  // 벽을 뚫고 지나가지 않았는지 4px 간격으로 확인한다.
  const steps = Math.max(1, Math.ceil(distance / 4));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (!isWalkable(layout, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t)) {
      return false;
    }
  }
  return true;
}

/** 문자열(사용자 ID)에서 만든 32비트 해시. 같은 사람은 같은 자리에서 시작한다. */
function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 처음 나타날 자리: 스폰 영역 안에서 사용자마다 다른 칸. 발밑 가운데 좌표(px) */
export function spawnPosition(layout: MapLayout, seed: string): Position {
  const { spawn } = layout;
  const cells = spawn.w * spawn.h;
  const start = hash(seed) % cells;
  for (let i = 0; i < cells; i++) {
    const cell = (start + i) % cells;
    const x = (spawn.x + (cell % spawn.w)) * TILE_SIZE + TILE_SIZE / 2;
    const y = (spawn.y + Math.floor(cell / spawn.w)) * TILE_SIZE + TILE_SIZE - 1;
    if (isWalkable(layout, x, y)) return { x, y };
  }
  throw new Error('스폰 영역에 설 수 있는 칸이 없습니다.');
}
