import { describe, expect, it } from 'vitest';
import { PROXIMITY_FULL_RADIUS, PROXIMITY_MAX_RADIUS, proximityGain } from './proximity.js';

const at = (x: number) => ({ x, y: 0 });

describe('proximityGain', () => {
  it('가까우면 원래 크기, 최대 반경 밖이면 들리지 않는다', () => {
    expect(proximityGain(at(0), at(0))).toBe(1);
    expect(proximityGain(at(0), at(PROXIMITY_FULL_RADIUS))).toBe(1);
    expect(proximityGain(at(0), at(PROXIMITY_MAX_RADIUS))).toBe(0);
    expect(proximityGain(at(0), at(PROXIMITY_MAX_RADIUS * 3))).toBe(0);
  });

  it('사이에서는 멀수록 작아지고, 반경 안이면 0이 되지 않는다', () => {
    const near = proximityGain(at(0), at(PROXIMITY_FULL_RADIUS + 10));
    const far = proximityGain(at(0), at(PROXIMITY_MAX_RADIUS - 10));
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
    expect(far).toBeLessThan(1);
  });

  it('음량은 0.1 단위라 조금 움직여서는 바뀌지 않는다', () => {
    const a = proximityGain(at(0), at(100));
    const b = proximityGain(at(0), at(101));
    expect(a).toBe(b);
    expect(Math.round(a * 10) / 10).toBeCloseTo(a);
  });
});
