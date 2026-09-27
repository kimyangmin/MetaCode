import {
  type Direction,
  type MapLayout,
  MOVE_SPEED,
  type Position,
  isWalkable,
} from '@metacode/shared';

/** 한 프레임에 움직일 수 있는 최대 시간. 탭이 잠깐 멈췄다 돌아와도 한 번에 멀리 가지 않는다 */
const MAX_FRAME_MS = 50;

/** 방향키 입력(-1, 0, 1)의 방향. 대각선이면 좌우를 본다 */
export function directionOf(dx: number, dy: number, fallback: Direction): Direction {
  if (dx < 0) return 'left';
  if (dx > 0) return 'right';
  if (dy < 0) return 'up';
  if (dy > 0) return 'down';
  return fallback;
}

/** 한 축으로 최대 amount만큼, 막히기 직전까지 움직인다 (1px 단위로 줄여 가며 확인) */
function slide(layout: MapLayout, from: Position, axis: 'x' | 'y', amount: number): Position {
  const sign = Math.sign(amount);
  for (let d = Math.abs(amount); d > 0; d = Math.max(0, d - 1)) {
    const next = { ...from, [axis]: from[axis] + sign * d };
    if (isWalkable(layout, next.x, next.y)) return next;
    if (d <= 1) break;
  }
  return from;
}

/**
 * 방향키 이동 한 프레임. 축마다 따로 움직여서 벽에 비스듬히 부딪히면 벽을 따라 미끄러진다.
 * 대각선은 속도가 빨라지지 않도록 정규화한다.
 */
export function stepByInput(
  layout: MapLayout,
  from: Position,
  dx: number,
  dy: number,
  elapsedMs: number,
): Position {
  if (dx === 0 && dy === 0) return from;
  const distance = (MOVE_SPEED * Math.min(elapsedMs, MAX_FRAME_MS)) / 1000;
  const length = Math.hypot(dx, dy);
  const afterX = dx === 0 ? from : slide(layout, from, 'x', (dx / length) * distance);
  return dy === 0 ? afterX : slide(layout, afterX, 'y', (dy / length) * distance);
}

/**
 * 목표 지점을 향해 한 프레임 움직인다 (마우스 클릭 이동). 길은 이미 찾아 두었으므로 직선으로 간다.
 * 가는 길이 막혀 있으면 null (길을 버린다).
 */
export function stepToward(
  layout: MapLayout,
  from: Position,
  target: Position,
  elapsedMs: number,
): { position: Position; arrived: boolean } | null {
  const distance = (MOVE_SPEED * Math.min(elapsedMs, MAX_FRAME_MS)) / 1000;
  const remaining = Math.hypot(target.x - from.x, target.y - from.y);
  if (remaining <= distance) {
    return isWalkable(layout, target.x, target.y) ? { position: target, arrived: true } : null;
  }
  const ratio = distance / remaining;
  const next = { x: from.x + (target.x - from.x) * ratio, y: from.y + (target.y - from.y) * ratio };
  return isWalkable(layout, next.x, next.y) ? { position: next, arrived: false } : null;
}

// ── 다른 사람 캐릭터: 받은 위치 사이를 부드럽게 잇는다 ──

/** 받은 위치를 이만큼 늦게 그려서, 다음 위치가 올 때까지 두 위치 사이를 보간할 수 있게 한다 */
export const INTERPOLATION_DELAY_MS = 150;
/** 이보다 멀리 떨어진 위치를 받으면(되돌림, 재접속) 보간하지 않고 바로 옮긴다 */
const SNAP_DISTANCE_PX = 64;

interface Sample extends Position {
  t: number;
}

/** 다른 사람의 위치 기록. 받은 시각과 함께 쌓아 두고, 조금 과거 시점의 위치를 보간해서 그린다 */
export class RemoteTrack {
  private samples: Sample[];

  constructor(position: Position, now: number) {
    this.samples = [{ ...position, t: now }];
  }

  push(position: Position, now: number): void {
    const last = this.samples.at(-1)!;
    if (Math.hypot(position.x - last.x, position.y - last.y) > SNAP_DISTANCE_PX) {
      this.samples = [{ ...position, t: now }];
      return;
    }
    this.samples.push({ ...position, t: now });
    // 보간에 필요한 만큼만 남긴다.
    while (this.samples.length > 2 && this.samples[1]!.t <= now - INTERPOLATION_DELAY_MS * 2) {
      this.samples.shift();
    }
  }

  /** 지금 그릴 위치. 새 위치가 끊기면 마지막 위치에 멈춘다 (앞질러 추측하지 않는다) */
  at(now: number): Position {
    const renderAt = now - INTERPOLATION_DELAY_MS;
    const { samples } = this;
    if (renderAt <= samples[0]!.t) return { x: samples[0]!.x, y: samples[0]!.y };
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1]!;
      const b = samples[i]!;
      if (renderAt <= b.t) {
        const ratio = b.t === a.t ? 1 : (renderAt - a.t) / (b.t - a.t);
        return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
      }
    }
    const last = samples.at(-1)!;
    return { x: last.x, y: last.y };
  }
}
