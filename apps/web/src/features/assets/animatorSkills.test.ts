import {
  type Animator,
  animatorLocksMovement,
  animatorProblems,
  animatorSchema,
  characterMotions,
  defaultAnimator,
  fireTrigger,
  setAnimatorBool,
  startAnimator,
  stepAnimator,
} from '@metacode/shared';
import { describe, expect, it } from 'vitest';
import { addSkill } from './animatorSkills';

const names = new Set([
  'idle-right',
  'walk-right',
  'jump-right',
  'slash',
  'kick',
  'spin',
  'charge',
  'blast',
]);
const base = defaultAnimator(names);
const cycle = () => 300;

const added = (result: Animator | string): Animator => {
  if (typeof result === 'string') throw new Error(result);
  return result;
};

describe('스킬 만들기', () => {
  it('한 번 쓰는 기술: 키를 누르면 틀고, 끝나면 시작 상태로 돌아오며 그동안 움직이지 않는다', () => {
    const animator = added(
      addSkill(base, {
        kind: 'once',
        name: 'slash',
        key: 'z',
        label: '베기',
        animations: ['slash'],
        lockMove: true,
      }),
    );
    expect(animatorSchema.safeParse(animator).success).toBe(true);
    expect(animatorProblems(animator, names)).toEqual([]);
    expect(characterMotions({ animations: {}, animator })).toEqual([
      { name: 'slash', key: 'z', label: '베기', loop: false, parameter: 'trigger' },
    ]);
    const rt = startAnimator(animator, 0);
    fireTrigger(rt, 'slash', 0);
    stepAnimator(animator, rt, 0, cycle);
    expect(rt.state).toBe('slash');
    expect(animatorLocksMovement(animator, rt)).toBe(true);
    stepAnimator(animator, rt, 300, cycle);
    expect(rt.state).toBe('idle');
  });

  it('콤보: 치는 중에 누르면 다음 타로, 안 누르면 돌아온다', () => {
    const animator = added(
      addSkill(base, {
        kind: 'combo',
        name: 'attack',
        key: 'x',
        animations: ['slash', 'kick', 'spin'],
        lockMove: false,
        comboAt: 0.6,
      }),
    );
    expect(animatorProblems(animator, names)).toEqual([]);
    const rt = startAnimator(animator, 0);
    fireTrigger(rt, 'attack', 0);
    stepAnimator(animator, rt, 0, cycle);
    expect(rt.state).toBe('attack-1');
    fireTrigger(rt, 'attack', 30);
    stepAnimator(animator, rt, 100, cycle);
    expect(rt.state).toBe('attack-1');
    stepAnimator(animator, rt, 180, cycle);
    expect(rt.state).toBe('attack-2');
    // 2타에서는 누르지 않았다: 끝나면 대기
    stepAnimator(animator, rt, 480, cycle);
    expect(rt.state).toBe('idle');
  });

  it('모아 쏘기: 누르는 동안 모으고, 떼면 쏜 뒤 돌아온다', () => {
    const animator = added(
      addSkill(base, {
        kind: 'hold',
        name: 'charge',
        key: 'c',
        animations: ['charge', 'blast'],
        lockMove: true,
      }),
    );
    expect(animatorProblems(animator, names)).toEqual([]);
    expect(characterMotions({ animations: {}, animator })[0]).toMatchObject({ hold: true });
    const rt = startAnimator(animator, 0);
    setAnimatorBool(rt, 'charge', true);
    stepAnimator(animator, rt, 0, cycle);
    expect(rt.state).toBe('charge');
    stepAnimator(animator, rt, 900, cycle);
    expect(rt.state).toBe('charge');
    setAnimatorBool(rt, 'charge', false);
    stepAnimator(animator, rt, 1000, cycle);
    expect(rt.state).toBe('charge-release');
    stepAnimator(animator, rt, 1300, cycle);
    expect(rt.state).toBe('idle');
  });

  it('이미 쓰는 키나 모자란 애니메이션은 거절하고, 이름이 겹치면 피한다', () => {
    const first = added(
      addSkill(base, {
        kind: 'once',
        name: 'slash',
        key: 'z',
        animations: ['slash'],
        lockMove: false,
      }),
    );
    expect(
      addSkill(first, {
        kind: 'once',
        name: 'kick',
        key: 'z',
        animations: ['kick'],
        lockMove: false,
      }),
    ).toContain('Z 키');
    expect(
      addSkill(first, { kind: 'combo', name: 'kick', animations: ['kick'], lockMove: false }),
    ).toContain('두 타');
    const second = added(
      addSkill(first, { kind: 'once', name: 'slash', animations: ['kick'], lockMove: false }),
    );
    expect(second.parameters.map((p) => p.name)).toEqual(['slash', 'slash-2']);
    expect(second.states.map((s) => s.name)).toContain('slash-2');
  });
});
