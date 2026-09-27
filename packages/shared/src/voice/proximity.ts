import { TILE_SIZE } from '../plaza/layout.js';
import type { Position } from '../plaza/movement.js';

/** 근접 음성: 이 거리(px) 안이면 원래 크기로 들린다. 3타일 */
export const PROXIMITY_FULL_RADIUS = 3 * TILE_SIZE;
/** 이 거리(px) 밖이면 들리지 않는다 (오디오를 구독하지 않는다). 10타일 */
export const PROXIMITY_MAX_RADIUS = 10 * TILE_SIZE;
/** 음량 단계 수. 걸을 때마다 조금씩 바뀌는 음량을 모두 보내지 않도록 0.1 단위로 맞춘다 */
const GAIN_STEPS = 10;

/**
 * 두 캐릭터 사이 거리에 따른 음량 (0~1). 가까우면 1, 멀어질수록 줄고, 최대 반경 밖이면 0.
 * 서버가 계산해서 보내고, 클라이언트는 0이면 구독을 끊고 아니면 그 음량으로 튼다.
 */
export function proximityGain(a: Position, b: Position): number {
  const distance = Math.hypot(a.x - b.x, a.y - b.y);
  if (distance <= PROXIMITY_FULL_RADIUS) return 1;
  if (distance >= PROXIMITY_MAX_RADIUS) return 0;
  const ratio =
    1 - (distance - PROXIMITY_FULL_RADIUS) / (PROXIMITY_MAX_RADIUS - PROXIMITY_FULL_RADIUS);
  // 0에 가까운 값이 0으로 떨어지지 않게 올림한다 (반경 안이면 조금이라도 들린다).
  return Math.min(1, Math.ceil(ratio * GAIN_STEPS) / GAIN_STEPS);
}
