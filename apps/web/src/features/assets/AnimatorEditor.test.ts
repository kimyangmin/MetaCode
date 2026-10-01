import { ANIMATOR_STATE_LIMIT, type Animator, animatorProblems } from '@metacode/shared';
import { describe, expect, it } from 'vitest';
import { withStatesFor } from './AnimatorEditor';

const animator: Animator = {
  entry: 'idle',
  states: [
    { name: 'idle', animation: 'idle', x: 0, y: 0 },
    { name: 'dance', animation: 'wave', x: 200, y: 80 },
  ],
  parameters: [],
  transitions: [],
};

describe('GIF로 상태 추가', () => {
  it('새 애니메이션마다 그것을 트는 상태를 지금 상태들 아래에 더하고, 이름이 겹치면 -2', () => {
    const next = withStatesFor(animator, ['dance', 'spin']);
    const added = next.states.slice(animator.states.length);
    expect(added.map((s) => [s.name, s.animation])).toEqual([
      ['dance-2', 'dance'],
      ['spin', 'spin'],
    ]);
    expect(added.every((s) => s.y > 80)).toBe(true);
    expect(added[1]!.x).toBeGreaterThan(added[0]!.x);
    const names = new Set(['idle-down', 'wave', 'dance', 'spin']);
    expect(animatorProblems(next, names)).toEqual([]);
  });

  it('상태 한도를 넘는 것은 더하지 않는다', () => {
    const many = Array.from({ length: ANIMATOR_STATE_LIMIT + 5 }, (_, i) => `a${i}`);
    expect(withStatesFor(animator, many).states).toHaveLength(ANIMATOR_STATE_LIMIT);
  });
});
