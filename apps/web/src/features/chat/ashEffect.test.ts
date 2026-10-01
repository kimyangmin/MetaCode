import { describe, expect, it } from 'vitest';
import { crumbleEdgeX, particleCount } from './ashEffect';

describe('재가 되어 사라지는 연출', () => {
  it('부서지는 경계는 메시지 왼쪽 밖에서 시작해 오른쪽 밖에서 끝난다', () => {
    const width = 400;
    // 시작: 경계가 왼쪽 밖이라 전부 보인다. 끝: 오른쪽 밖이라 전부 지워진다.
    expect(crumbleEdgeX(0, width)).toBeLessThan(0);
    expect(crumbleEdgeX(1, width)).toBeGreaterThan(width);
    // 왼쪽에서 오른쪽으로만 간다
    expect(crumbleEdgeX(0.5, width)).toBeGreaterThan(crumbleEdgeX(0.25, width));
  });

  it('입자 수는 메시지 넓이에 비례하되 너무 적거나 많지 않다', () => {
    expect(particleCount(40, 20)).toBe(60);
    expect(particleCount(600, 48)).toBe(320);
    const mid = particleCount(300, 40);
    expect(mid).toBeGreaterThan(60);
    expect(mid).toBeLessThan(320);
  });
});
