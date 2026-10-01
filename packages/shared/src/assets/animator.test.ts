import { describe, expect, it } from 'vitest';
import {
  ANY_STATE,
  type Animator,
  TRIGGER_HOLD_MS,
  animatorAnimationChoices,
  animatorProblems,
  defaultAnimator,
  fireTrigger,
  setAnimatorBool,
  startAnimator,
  stepAnimator,
} from './animator.js';

const names = new Set([
  'idle-down',
  'idle-right',
  'walk-down',
  'walk-right',
  'jump-right',
  'emote',
  'dance',
]);
/** 모든 상태가 한 번 도는 데 300ms */
const cycle = () => 300;

describe('애니메이터 검증', () => {
  it('기본 그래프는 문제가 없고, 점프 애니메이션이 있을 때만 점프 상태를 넣는다', () => {
    expect(animatorProblems(defaultAnimator(names), names)).toEqual([]);
    const noJump = new Set([...names].filter((n) => !n.startsWith('jump')));
    expect(defaultAnimator(noJump).states.map((s) => s.name)).toEqual(['idle', 'walk', 'emote']);
  });

  it('첨부 모션이 없으면 기본 그래프에 첨부 상태와 그 전이를 넣지 않는다 (저장이 막히지 않게)', () => {
    const noEmote = new Set([...names].filter((n) => n !== 'emote'));
    const animator = defaultAnimator(noEmote);
    expect(animator.states.map((s) => s.name)).toEqual(['idle', 'walk', 'jump']);
    expect(animator.transitions.some((t) => t.to === 'emote' || t.from === 'emote')).toBe(false);
    expect(animatorProblems(animator, noEmote)).toEqual([]);
  });

  it('없는 애니메이션·상태·파라미터, 겹치는 이름, 조건 없이 바로 넘어가는 전이를 잡는다', () => {
    const animator: Animator = {
      entry: 'missing',
      states: [
        { name: 'idle', animation: 'idle', x: 0, y: 0 },
        { name: 'idle', animation: 'fly', x: 0, y: 0 },
      ],
      parameters: [
        { name: 'moving', type: 'bool' },
        { name: 'wave', type: 'trigger' },
      ],
      transitions: [
        { from: 'idle', to: 'nowhere', conditions: [{ param: 'unknown' }] },
        { from: ANY_STATE, to: 'idle', conditions: [] },
        { from: 'idle', to: 'idle', conditions: [{ param: 'wave', value: true }] },
      ],
    };
    const problems = animatorProblems(animator, names).join('\n');
    expect(problems).toMatch(/상태 이름 idle이\(가\) 겹칩니다/);
    expect(problems).toMatch(/애니메이션 fly이\(가\) 없습니다/);
    expect(problems).toMatch(/시작 상태가 없습니다/);
    expect(problems).toMatch(/moving은\(는\) 광장이 쓰는 파라미터/);
    expect(problems).toMatch(/도착 상태가 없습니다/);
    expect(problems).toMatch(/파라미터 unknown이\(가\) 없습니다/);
    expect(problems).toMatch(/끝나면 넘어가기/);
    expect(problems).toMatch(/트리거 조건에는 값을 적지 않습니다/);
  });

  it('방향이 붙은 애니메이션은 방향을 뗀 이름으로 고른다', () => {
    expect(animatorAnimationChoices(names)).toEqual(['dance', 'emote', 'idle', 'jump', 'walk']);
  });
});

describe('애니메이터 재생', () => {
  const animator = defaultAnimator(names);

  it('불 값 조건으로 대기 ↔ 걷기를 오간다', () => {
    const rt = startAnimator(animator, 0);
    expect(rt.state).toBe('idle');
    setAnimatorBool(rt, 'moving', true);
    expect(stepAnimator(animator, rt, 10, cycle)).toBe(true);
    expect(rt).toMatchObject({ state: 'walk', since: 10 });
    expect(stepAnimator(animator, rt, 20, cycle)).toBe(false);
    setAnimatorBool(rt, 'moving', false);
    stepAnimator(animator, rt, 30, cycle);
    expect(rt.state).toBe('idle');
  });

  it('Any State 트리거는 어디서든 넘어가고, "끝나면" 전이는 한 번 다 돈 뒤에 돌아온다', () => {
    const rt = startAnimator(animator, 0);
    setAnimatorBool(rt, 'moving', true);
    stepAnimator(animator, rt, 0, cycle);
    fireTrigger(rt, 'emote', 100);
    stepAnimator(animator, rt, 100, cycle);
    expect(rt.state).toBe('emote');
    // 트리거는 쓰면 사라진다
    expect(rt.triggers.size).toBe(0);
    stepAnimator(animator, rt, 300, cycle);
    expect(rt.state).toBe('emote');
    stepAnimator(animator, rt, 400, cycle);
    // emote → idle (끝나면) → walk (걷는 중)까지 이어서 넘어간다
    expect(rt.state).toBe('walk');
  });

  it('Any State에서 지금 상태로 가는 불 값 전이는 처음부터 다시 틀지 않는다', () => {
    const rt = startAnimator(animator, 0);
    setAnimatorBool(rt, 'airborne', true);
    stepAnimator(animator, rt, 0, cycle);
    expect(rt).toMatchObject({ state: 'jump', since: 0 });
    stepAnimator(animator, rt, 50, cycle);
    expect(rt.since).toBe(0);
  });

  it('쓰이지 않은 트리거는 잠깐 뒤에 버린다', () => {
    const rt = startAnimator(animator, 0);
    fireTrigger(rt, 'land', 0);
    stepAnimator(animator, rt, TRIGGER_HOLD_MS + 1, cycle);
    expect(rt.triggers.size).toBe(0);
  });

  it('직접 만든 트리거로 상태를 옮기고, 맞물린 전이도 무한히 돌지 않는다', () => {
    const custom: Animator = {
      ...animator,
      states: [...animator.states, { name: 'dance', animation: 'dance', x: 0, y: 0 }],
      parameters: [{ name: 'party', type: 'trigger', key: '1' }],
      transitions: [
        ...animator.transitions,
        { from: 'idle', to: 'dance', conditions: [{ param: 'party' }] },
        { from: 'dance', to: 'idle', conditions: [], exitTime: true },
      ],
    };
    const rt = startAnimator(custom, 0);
    fireTrigger(rt, 'party', 0);
    stepAnimator(custom, rt, 0, cycle);
    expect(rt.state).toBe('dance');
    // 한 바퀴가 0ms인 애니메이션이라도 멈춘다
    stepAnimator(custom, rt, 10, () => 0);
    expect(['idle', 'dance']).toContain(rt.state);
  });
});
