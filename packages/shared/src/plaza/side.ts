import type { MapLayout } from './layout.js';
import {
  DISTANCE_SLACK_PX,
  MAX_STEP_MS,
  MOVE_SPEED,
  type Position,
  SPEED_TOLERANCE,
  isClearPath,
} from './movement.js';

/**
 * 횡스크롤 광장의 물리 (px, 초). 클라이언트가 이 값으로 움직이고, 서버는 같은 값으로 검증한다.
 * 가로 속도는 탑다운과 같은 MOVE_SPEED다.
 */
export const GRAVITY = 1200;
/** 점프로 오르는 높이: 3.5타일. 세 칸 위 발판까지 올라간다 */
export const JUMP_HEIGHT = 56;
export const JUMP_SPEED = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT);
export const MAX_FALL_SPEED = 480;

/**
 * 서버가 횡스크롤 이동을 받아들일지. 가로는 걷는 속도, 세로는 오를 때 점프 속도·내려갈 때 최대 낙하 속도 안이고,
 * 가는 길에 막힌 칸이 없으며, 마지막으로 딛은 땅(groundY)보다 점프 높이 이상 오르지 않았는지 본다.
 * 클라이언트는 땅에 내려앉는 순간의 위치를 바로 보내므로(서버가 딛은 땅을 놓치지 않게) 연달아 뛰어도 된다.
 */
export function isValidSideMove(
  layout: MapLayout,
  from: Position,
  to: Position,
  elapsedMs: number,
  groundY: number,
): boolean {
  if (!Number.isFinite(to.x) || !Number.isFinite(to.y)) return false;
  const seconds = Math.min(Math.max(elapsedMs, 0), MAX_STEP_MS) / 1000;
  const reach = (speed: number) => speed * seconds * SPEED_TOLERANCE + DISTANCE_SLACK_PX;
  if (Math.abs(to.x - from.x) > reach(MOVE_SPEED)) return false;
  const dy = to.y - from.y;
  if (Math.abs(dy) > reach(dy < 0 ? JUMP_SPEED : MAX_FALL_SPEED)) return false;
  if (to.y < groundY - JUMP_HEIGHT - DISTANCE_SLACK_PX) return false;
  return isClearPath(layout, from, to);
}
