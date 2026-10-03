import {
  ANIMATOR_PARAMETER_LIMIT,
  ANIMATOR_STATE_LIMIT,
  ANIMATOR_TRANSITION_LIMIT,
  ANY_STATE,
  type Animator,
  type AnimatorParameter,
  AnimatorParamType,
  type AnimatorState,
  type AnimatorTransition,
  type ParameterKey,
  animatorParameters,
} from '@metacode/shared';

/** 그래프 위 상태 상자 크기 (AnimatorEditor와 같은 값) */
export const NODE_W = 150;
export const NODE_H = 48;
/** 끌어 옮길 때 맞추는 칸 */
export const GRID = 8;

export const snap = (v: number) => Math.round(v / GRID) * GRID;

/** 비어 있는 이름 (base, base-2, base-3 …) */
export function freeName(base: string, used: ReadonlySet<string>): string {
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/**
 * 스킬 종류:
 * - once: 키를 누르면 기술 하나를 한 번 쓰고 시작 상태로 돌아온다
 * - combo: 키를 누를 때마다 1타 → 2타 → 3타 (치는 중에 누르면 이어서, 안 누르면 끝나고 돌아옴)
 * - hold: 누르고 있는 동안 모으는 애니메이션, 떼면 쏘는 애니메이션(없으면 바로 돌아옴)
 */
export type SkillKind = 'once' | 'combo' | 'hold';

export interface SkillPlan {
  kind: SkillKind;
  /** 파라미터와 상태 이름의 바탕 (영문 소문자) */
  name: string;
  key?: ParameterKey;
  /** 광장 모션 목록(✨)에 보일 이름 */
  label?: string;
  /** once: [기술], combo: [1타, 2타, (3타)], hold: [모으기, (쏘기)] */
  animations: string[];
  /** 기술을 쓰는 동안 캐릭터가 움직이지 않는다 */
  lockMove: boolean;
  /** combo: 다음 타로 넘어가는 지점 (지금 타의 이 비율부터) */
  comboAt?: number;
}

/** 스킬 하나에 드는 상태·전이 수 (한도 확인용) */
export function skillCost(plan: Pick<SkillPlan, 'kind' | 'animations'>): {
  states: number;
  transitions: number;
} {
  const n = plan.animations.length;
  if (plan.kind === 'once') return { states: 1, transitions: 2 };
  if (plan.kind === 'combo') return { states: n, transitions: 1 + (n - 1) + n };
  return n > 1 ? { states: 2, transitions: 3 } : { states: 1, transitions: 2 };
}

/**
 * 스킬을 그래프에 더한다: 파라미터(트리거 또는 누르는 동안 켜지는 불 값)와 상태, 전이를 만들고 끝나면 시작
 * 상태로 돌아오게 잇는다. 기술 상태는 Any State 전이로 끊기지 않게(콤보 중에 키를 다시 눌러도 처음부터
 * 다시 틀지 않게) 하고, 고르면 이동도 막는다. 한도를 넘거나 애니메이션이 모자라면 문제를 글로 돌려준다.
 */
export function addSkill(animator: Animator, plan: SkillPlan): Animator | string {
  const animations = plan.animations.filter(Boolean);
  if (animations.length === 0) return '애니메이션을 고르세요.';
  if (plan.kind === 'combo' && animations.length < 2) return '콤보는 두 타 이상이어야 합니다.';
  const cost = skillCost({ kind: plan.kind, animations });
  if (animator.states.length + cost.states > ANIMATOR_STATE_LIMIT) {
    return `상태는 ${ANIMATOR_STATE_LIMIT}개까지입니다.`;
  }
  if (animator.transitions.length + cost.transitions > ANIMATOR_TRANSITION_LIMIT) {
    return `전이는 ${ANIMATOR_TRANSITION_LIMIT}개까지입니다.`;
  }
  if (animator.parameters.length >= ANIMATOR_PARAMETER_LIMIT) {
    return `파라미터는 ${ANIMATOR_PARAMETER_LIMIT}개까지입니다.`;
  }
  if (plan.key && animator.parameters.some((p) => p.key === plan.key)) {
    return `${plan.key.toUpperCase()} 키는 이미 쓰고 있습니다.`;
  }

  const paramName = freeName(plan.name, new Set(animatorParameters(animator).keys()));
  const usedStates = new Set(animator.states.map((s) => s.name));
  const stateName = (base: string) => {
    const name = freeName(base, usedStates);
    usedStates.add(name);
    return name;
  };
  const left = Math.min(...animator.states.map((s) => s.x));
  const top = Math.max(...animator.states.map((s) => s.y)) + NODE_H + 72;
  const place = (i: number) => ({ x: snap(left + i * (NODE_W + 40)), y: snap(top) });
  const skillState = (name: string, animation: string, i: number, loop = false): AnimatorState => ({
    name,
    animation,
    ...(loop ? {} : { loop: false }),
    ...(plan.lockMove ? { lockMove: true } : {}),
    noInterrupt: true,
    ...place(i),
  });

  const parameter: AnimatorParameter = {
    name: paramName,
    type: plan.kind === 'hold' ? AnimatorParamType.Bool : AnimatorParamType.Trigger,
    ...(plan.key ? { key: plan.key } : {}),
    ...(plan.label?.trim() ? { label: plan.label.trim() } : {}),
    ...(plan.kind === 'hold' ? { hold: true } : {}),
  };
  const entry = animator.entry;
  const back = (from: string): AnimatorTransition => ({
    from,
    to: entry,
    conditions: [],
    exitTime: true,
  });
  const states: AnimatorState[] = [];
  const transitions: AnimatorTransition[] = [];

  if (plan.kind === 'once') {
    const name = stateName(paramName);
    states.push(skillState(name, animations[0]!, 0));
    transitions.push({ from: ANY_STATE, to: name, conditions: [{ param: paramName }] }, back(name));
  } else if (plan.kind === 'combo') {
    const names = animations.map((_, i) => stateName(`${paramName}-${i + 1}`));
    names.forEach((name, i) => states.push(skillState(name, animations[i]!, i)));
    transitions.push({ from: ANY_STATE, to: names[0]!, conditions: [{ param: paramName }] });
    names.forEach((name, i) => {
      const next = names[i + 1];
      // 다음 타가 먼저: 치는 중에 누른 트리거는 지금 타가 그 지점에 이를 때까지 남아 있다
      if (next) {
        transitions.push({
          from: name,
          to: next,
          conditions: [{ param: paramName }],
          exitTime: true,
          ...(plan.comboAt && plan.comboAt < 1 ? { exitAt: plan.comboAt } : {}),
        });
      }
      transitions.push(back(name));
    });
  } else {
    const charge = stateName(paramName);
    states.push({ ...skillState(charge, animations[0]!, 0, true) });
    transitions.push({
      from: ANY_STATE,
      to: charge,
      conditions: [{ param: paramName, value: true }],
    });
    const releaseAnimation = animations[1];
    if (releaseAnimation) {
      const release = stateName(`${paramName}-release`);
      states.push(skillState(release, releaseAnimation, 1));
      transitions.push(
        { from: charge, to: release, conditions: [{ param: paramName, value: false }] },
        back(release),
      );
    } else {
      transitions.push({
        from: charge,
        to: entry,
        conditions: [{ param: paramName, value: false }],
      });
    }
  }

  return {
    ...animator,
    parameters: [...animator.parameters, parameter],
    states: [...animator.states, ...states],
    transitions: [...animator.transitions, ...transitions],
  };
}
