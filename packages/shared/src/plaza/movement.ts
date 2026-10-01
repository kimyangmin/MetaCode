import { PlazaStyle } from '../domain/plaza.js';
import { Cell, type MapLayout, TILE_SIZE } from './layout.js';

/** 이동 속도 (px/초). 초당 6타일 */
export const MOVE_SPEED = 96;
/** 움직이는 동안 위치를 보내는 간격 */
export const MOVE_SEND_INTERVAL_MS = 100;

/**
 * 충돌 판정에 쓰는 발 영역 (px). 캐릭터 위치(x, y)는 발밑 가운데이고,
 * 16×32 캐릭터 중 발 부분만 부딪힌다 (머리는 장애물 앞을 지나갈 수 있다).
 */
export const FOOT = { width: 10, height: 6 } as const;

/**
 * 횡스크롤에서 부딪히는 몸 (px). 옆에서 보므로 머리도 천장에 부딪힌다.
 * 두 칸(32px) 높이의 굴은 지나갈 수 있게 캐릭터(32px)보다 조금 낮고, 발판 끝에 걸쳐 설 때
 * 허공에 떠 보이지 않게 발(그림의 발 폭)과 비슷하게 좁다.
 */
export const SIDE_BODY = { width: 8, height: 28 } as const;

export type Direction = 'down' | 'up' | 'left' | 'right';

export interface Position {
  x: number;
  y: number;
}

export function isSideScroll(layout: Pick<MapLayout, 'style'>): boolean {
  return layout.style === PlazaStyle.SideScroll;
}

/** 이 광장에서 부딪히는 영역: 탑다운은 발, 횡스크롤은 몸 전체 */
export function bodyOf(layout: Pick<MapLayout, 'style'>): { width: number; height: number } {
  return isSideScroll(layout) ? SIDE_BODY : FOOT;
}

/**
 * 이 위치에 설 수 있는지 (맵 안이고 막힌 칸과 겹치지 않는지). 횡스크롤의 발판은 몸을 막지 않는다
 * (위에서 내려올 때만 딛는 것은 isGrounded, groundBelow가 따로 본다).
 */
export function isWalkable(layout: MapLayout, x: number, y: number): boolean {
  const body = bodyOf(layout);
  const left = x - body.width / 2;
  const right = x + body.width / 2 - 0.01;
  const top = y - body.height;
  const bottom = y - 0.01;
  if (
    left < 0 ||
    top < 0 ||
    right >= layout.width * TILE_SIZE ||
    bottom >= layout.height * TILE_SIZE
  ) {
    return false;
  }
  // 몸이 칸보다 크면 가운데 줄도 확인한다 (네 모서리만 보면 가운데 칸의 벽을 지나친다).
  const rows = [top];
  for (let py = top + TILE_SIZE - 1; py < bottom; py += TILE_SIZE - 1) rows.push(py);
  rows.push(bottom);
  for (const py of rows) {
    const ty = Math.floor(py / TILE_SIZE);
    for (const px of [left, right]) {
      const tx = Math.floor(px / TILE_SIZE);
      if (layout.blocked[ty * layout.width + tx] === Cell.Solid) return false;
    }
  }
  return true;
}

/** 이동을 한 번에 이만큼 이상 건너뛰었다고 보지 않는다 (오래 멈췄다가 순간이동하는 것 방지) */
export const MAX_STEP_MS = 500;
/** 네트워크 지연과 프레임 차이를 감안한 여유 */
export const SPEED_TOLERANCE = 1.5;
export const DISTANCE_SLACK_PX = 4;

/** 두 위치 사이의 곧은 선이 막히지 않았는지 4px 간격으로 확인한다 */
function isClearLine(layout: MapLayout, from: Position, to: Position): boolean {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(1, Math.ceil(distance / 4));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (!isWalkable(layout, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t)) {
      return false;
    }
  }
  return true;
}

/**
 * 벽을 뚫고 지나가지 않았는지. 곧은 선이 막혔어도 가로 먼저·세로 먼저로 꺾어 간 길이 열려 있으면 받아들인다.
 * 클라이언트는 축마다 따로 움직여서(벽을 따라 미끄러지기, 횡스크롤에서 턱에 붙어 뛰어오른 뒤 올라서기)
 * 보내는 간격(100ms) 사이에 모서리를 돌아가는데, 곧은 선만 보면 그 모서리를 스쳐서 되돌려졌다
 * (오브젝트 옆에서 자꾸 끼고, 손가락 이동으로는 턱을 못 올라감). 한 칸을 통째로 건너뛰는 것은 여전히 막는다.
 */
export function isClearPath(layout: MapLayout, from: Position, to: Position): boolean {
  if (isClearLine(layout, from, to)) return true;
  const xFirst = { x: to.x, y: from.y };
  if (isClearLine(layout, from, xFirst) && isClearLine(layout, xFirst, to)) return true;
  const yFirst = { x: from.x, y: to.y };
  return isClearLine(layout, from, yFirst) && isClearLine(layout, yFirst, to);
}

/**
 * 서버가 쓰는 이동 시간 (ms): 허용 속도(MOVE_SPEED × SPEED_TOLERANCE)로 이만큼 가는 데 걸리는 시간.
 * 서버는 받아들인 이동마다 기록한 시각을 "받은 시각"이 아니라 이 시간만큼만 앞으로 옮긴다. 그래서 늦게 온 위치
 * 바로 뒤에 다음 위치가 붙어 와도(모바일 망의 지연·몰림) 앞에서 남긴 시간으로 받아들이고, 평균 속도는 그대로
 * 제한된다. 남겨 둘 수 있는 시간은 MAX_STEP_MS까지 (횡스크롤은 sideMoveCostMs).
 */
export function moveCostMs(from: Position, to: Position): number {
  return (Math.hypot(to.x - from.x, to.y - from.y) / (MOVE_SPEED * SPEED_TOLERANCE)) * 1000;
}

/**
 * 서버가 이동을 받아들일지 (탑다운). 클라이언트는 자기 캐릭터를 먼저 움직이고(예측) 주기적으로 위치를 보내므로,
 * 마지막으로 받아들인 위치에서 속도상 갈 수 있는 거리인지, 가는 길에 장애물이 없는지만 본다.
 * elapsedMs는 서버의 이동 시간 기록(moveCostMs)에서 지난 시간이라 음수일 수 있다 (시간을 앞당겨 썼음).
 * 횡스크롤은 isValidSideMove.
 */
export function isValidMove(
  layout: MapLayout,
  from: Position,
  to: Position,
  elapsedMs: number,
): boolean {
  if (!Number.isFinite(to.x) || !Number.isFinite(to.y)) return false;
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const allowed = Math.max(
    0,
    (MOVE_SPEED * Math.min(elapsedMs, MAX_STEP_MS) * SPEED_TOLERANCE) / 1000 + DISTANCE_SLACK_PX,
  );
  if (distance > allowed) return false;
  return isClearPath(layout, from, to);
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

/**
 * 처음 나타날 자리: 스폰 영역 안에서 사용자마다 다른 칸. 발밑 가운데 좌표(px).
 * 횡스크롤이면 그 칸에서 아래로 떨어뜨려 땅(또는 발판) 위에 세운다.
 */
export function spawnPosition(layout: MapLayout, seed: string): Position {
  const { spawn } = layout;
  const cells = spawn.w * spawn.h;
  const start = hash(seed) % cells;
  for (let i = 0; i < cells; i++) {
    const cell = (start + i) % cells;
    const x = (spawn.x + (cell % spawn.w)) * TILE_SIZE + TILE_SIZE / 2;
    const y = (spawn.y + Math.floor(cell / spawn.w)) * TILE_SIZE + TILE_SIZE - 1;
    if (isWalkable(layout, x, y)) {
      return isSideScroll(layout) ? { x, y: groundBelow(layout, x, y) } : { x, y };
    }
  }
  throw new Error('스폰 영역에 설 수 있는 칸이 없습니다.');
}

/**
 * 설 수 없는 자리(맵이 바뀌어 장애물 속에 남은 위치 등)에서 가장 가까운 설 수 있는 자리. 이미 설 수 있으면 그대로.
 * 가까운 칸부터 칸의 발밑 가운데를 보고, 횡스크롤이면 그 아래 땅에 세운다. 맵 전체에 없으면 null.
 * 장애물 속에 남은 위치는 모든 이동이 "장애물을 지난다"로 거절되어 영영 빠져나오지 못했다.
 */
export function nearestWalkable(layout: MapLayout, from: Position): Position | null {
  if (isWalkable(layout, from.x, from.y)) return from;
  const cx = Math.floor(from.x / TILE_SIZE);
  const cy = Math.floor((from.y - 0.01) / TILE_SIZE);
  const rings = Math.max(layout.width, layout.height);
  for (let r = 0; r <= rings; r++) {
    let best: Position | null = null;
    let bestDistance = Infinity;
    for (let ty = cy - r; ty <= cy + r; ty++) {
      for (let tx = cx - r; tx <= cx + r; tx++) {
        if (Math.max(Math.abs(tx - cx), Math.abs(ty - cy)) !== r) continue;
        if (tx < 0 || ty < 0 || tx >= layout.width || ty >= layout.height) continue;
        const x = tx * TILE_SIZE + TILE_SIZE / 2;
        const y = ty * TILE_SIZE + TILE_SIZE - 1;
        if (!isWalkable(layout, x, y)) continue;
        const distance = Math.hypot(x - from.x, y - from.y);
        if (distance < bestDistance) {
          best = { x, y };
          bestDistance = distance;
        }
      }
    }
    if (best)
      return isSideScroll(layout) ? { x: best.x, y: groundBelow(layout, best.x, best.y) } : best;
  }
  return null;
}

/** 스폰 영역에 설 수 있는 칸이 하나라도 있는지 (맵을 저장할 때 확인한다) */
export function hasStandableSpawn(layout: MapLayout): boolean {
  const { spawn } = layout;
  for (let ty = spawn.y; ty < spawn.y + spawn.h; ty++) {
    for (let tx = spawn.x; tx < spawn.x + spawn.w; tx++) {
      if (isWalkable(layout, tx * TILE_SIZE + TILE_SIZE / 2, ty * TILE_SIZE + TILE_SIZE - 1)) {
        return true;
      }
    }
  }
  return false;
}

// ── 횡스크롤: 땅과 발판 ──

/** y(칸 경계)에 발을 딛는 발판이 있는지: 발밑 바로 아래 칸이 발판이고 발이 그 칸의 윗변에 있다 */
export function isOnPlatform(layout: MapLayout, x: number, y: number): boolean {
  const top = Math.round(y / TILE_SIZE) * TILE_SIZE;
  if (Math.abs(y - top) > 0.5) return false;
  const row = top / TILE_SIZE;
  if (row < 0 || row >= layout.height) return false;
  const half = bodyOf(layout).width / 2;
  for (const px of [x - half, x + half - 0.01]) {
    const col = Math.floor(px / TILE_SIZE);
    if (col < 0 || col >= layout.width) continue;
    if (layout.blocked[row * layout.width + col] === Cell.Platform) return true;
  }
  return false;
}

/** 땅(막힌 칸이나 맵 바닥) 또는 발판 위에 서 있는지 */
export function isGrounded(layout: MapLayout, x: number, y: number): boolean {
  if (!isWalkable(layout, x, y)) return false;
  return !isWalkable(layout, x, y + 1) || isOnPlatform(layout, x, y);
}

/**
 * (x, y)에서 아래로 떨어지면 발이 닿는 높이 (칸 경계). 이미 서 있으면 y.
 * 막힌 칸이 나오면 그 칸의 윗변, 발판이 나오면 발판의 윗변, 아무것도 없으면 맵 바닥이다.
 */
export function groundBelow(layout: MapLayout, x: number, y: number): number {
  const limit = layout.height * TILE_SIZE;
  if (!isWalkable(layout, x, y)) return y;
  if (isGrounded(layout, x, y)) return y;
  for (let b = Math.ceil(y / TILE_SIZE) * TILE_SIZE; b <= limit; b += TILE_SIZE) {
    if (b > y && !isWalkable(layout, x, b)) return Math.max(y, b - TILE_SIZE);
    if (b > y && isOnPlatform(layout, x, b)) return b;
  }
  return limit;
}
