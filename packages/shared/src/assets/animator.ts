import { z } from 'zod';
import { ASSET_NAME_PATTERN, MOTION_LABEL_MAX_LENGTH, inputKeySchema } from './keys.js';

/**
 * 캐릭터 애니메이터 (유니티 Animator와 비슷한 상태 그래프).
 * - 상태(state) = 틀 애니메이션 하나. 애니메이션은 이름으로 가리키고, `walk`처럼 방향 없이 적으면
 *   광장이 보는 방향의 `walk-<방향>`을 찾는다 (횡스크롤용은 왼쪽이 없으면 오른쪽을 뒤집는 규칙 그대로).
 * - 전이(transition) = 상태에서 상태로 넘어가는 화살표. 조건(파라미터)을 모두 만족하고, "끝나면"이면
 *   애니메이션이 한 번 다 돈 뒤에 넘어간다. 출발이 Any State(`*`)면 어느 상태에서든 넘어간다.
 * - 파라미터: 광장이 정하는 것(걷는 중, 공중, 떨어지는 중, 뛰어오름, 착지, 첨부 보냄)과 직접 만든 것(직접
 *   단 키로 당기는 트리거, 켜고 끄거나 누르는 동안 켜지는 불 값).
 * - 스킬처럼 쓰는 상태 옵션: 재생 속도, 이동 막기(그 상태 동안 내 캐릭터가 움직이지 않음), Any State 전이로
 *   끊기지 않기(콤보 중에 같은 키를 다시 눌러도 처음부터 다시 틀지 않게). 전이는 애니메이션의 몇 % 지점에서
 *   넘어갈지(exitAt) 정할 수 있다.
 * 애니메이터가 없는 캐릭터는 예전 규칙(대기·걷기·점프·첨부 모션)대로 튼다.
 */

export const ANY_STATE = '*';

export const AnimatorParamType = { Trigger: 'trigger', Bool: 'bool' } as const;
export type AnimatorParamType = (typeof AnimatorParamType)[keyof typeof AnimatorParamType];

/** 광장이 정하는 파라미터. 직접 만든 파라미터는 이 이름을 쓸 수 없다 */
export const BUILTIN_ANIMATOR_PARAMETERS: readonly {
  name: string;
  type: AnimatorParamType;
  label: string;
}[] = [
  { name: 'moving', type: AnimatorParamType.Bool, label: '걷는 중' },
  { name: 'airborne', type: AnimatorParamType.Bool, label: '공중 (횡스크롤)' },
  { name: 'falling', type: AnimatorParamType.Bool, label: '떨어지는 중 (횡스크롤)' },
  { name: 'jump', type: AnimatorParamType.Trigger, label: '뛰어오름' },
  { name: 'land', type: AnimatorParamType.Trigger, label: '착지' },
  { name: 'emote', type: AnimatorParamType.Trigger, label: '첨부 보냄' },
];

export const ANIMATOR_STATE_LIMIT = 32;
export const ANIMATOR_PARAMETER_LIMIT = 16;
export const ANIMATOR_TRANSITION_LIMIT = 96;
export const ANIMATOR_CONDITION_LIMIT = 4;
/** 그래프 위 좌표 범위 (px) */
const GRAPH_EXTENT = 10000;

/** 상태의 재생 속도 (배) */
export const ANIMATOR_SPEED_MIN = 0.25;
export const ANIMATOR_SPEED_MAX = 4;
/** 전이가 넘어가는 지점 (애니메이션 한 바퀴의 비율) */
export const ANIMATOR_EXIT_AT_MIN = 0.05;

const nameSchema = z.string().regex(ASSET_NAME_PATTERN, '이름은 영문 소문자로 시작해야 합니다.');
const coordinate = z.number().int().min(-GRAPH_EXTENT).max(GRAPH_EXTENT);

const stateSchema = z.object({
  name: nameSchema,
  /** 틀 애니메이션 (방향 없이 적으면 보는 방향을 붙여 찾는다) */
  animation: nameSchema,
  /** false면 한 번 틀고 마지막 프레임에 머문다 (없으면 반복) */
  loop: z.boolean().optional(),
  /** 재생 속도 (없으면 1배). "끝나면 넘어가기"도 이 속도로 잰다 */
  speed: z.number().min(ANIMATOR_SPEED_MIN).max(ANIMATOR_SPEED_MAX).optional(),
  /** 이 상태 동안 내 캐릭터가 움직이지 않는다 (기술을 쓰는 동안 등. 횡스크롤의 떨어지기는 그대로) */
  lockMove: z.boolean().optional(),
  /** 이 상태에서는 Any State 전이를 보지 않는다 (콤보 중에 키를 다시 눌러도 처음부터 다시 틀지 않게) */
  noInterrupt: z.boolean().optional(),
  /** 그래프 편집기에서의 자리 */
  x: coordinate,
  y: coordinate,
});

const parameterSchema = z.object({
  name: nameSchema,
  type: z.enum([AnimatorParamType.Trigger, AnimatorParamType.Bool]),
  /** 광장에서 이 키를 누르면 트리거를 당기거나 불 값을 뒤집는다 (에디터에서 누른 키) */
  key: inputKeySchema.optional(),
  /** 불 값: 키를 누르는 동안만 켠다 (모아 쏘기 등). 없으면 누를 때마다 켜고 끈다 */
  hold: z.boolean().optional(),
  /** 모션 목록(✨)에 보일 이름 */
  label: z.string().trim().min(1).max(MOTION_LABEL_MAX_LENGTH).optional(),
});

const conditionSchema = z.object({
  param: nameSchema,
  /** 불 값 조건: 이 값일 때. 트리거는 적지 않는다 */
  value: z.boolean().optional(),
});

const transitionSchema = z.object({
  from: z.union([z.literal(ANY_STATE), nameSchema]),
  to: nameSchema,
  conditions: z.array(conditionSchema).max(ANIMATOR_CONDITION_LIMIT),
  /** 지금 상태의 애니메이션이 한 번 다 돈 뒤에만 넘어간다 (유니티의 Has Exit Time) */
  exitTime: z.boolean().optional(),
  /** exitTime이면 애니메이션의 이 비율 지점부터 넘어간다 (없으면 1 = 끝까지. 유니티의 Exit Time 값) */
  exitAt: z.number().min(ANIMATOR_EXIT_AT_MIN).max(1).optional(),
});

export const animatorSchema = z.object({
  entry: nameSchema,
  states: z.array(stateSchema).min(1).max(ANIMATOR_STATE_LIMIT),
  parameters: z.array(parameterSchema).max(ANIMATOR_PARAMETER_LIMIT),
  transitions: z.array(transitionSchema).max(ANIMATOR_TRANSITION_LIMIT),
  /** 그래프 편집기에서 Any State 상자의 자리 (없으면 편집기가 상태들 왼쪽에 둔다) */
  anyState: z.object({ x: coordinate, y: coordinate }).optional(),
});

export type Animator = z.infer<typeof animatorSchema>;
export type AnimatorState = Animator['states'][number];
export type AnimatorParameter = Animator['parameters'][number];
export type AnimatorTransition = Animator['transitions'][number];
export type AnimatorCondition = AnimatorTransition['conditions'][number];

/** 방향이 붙은 애니메이션 이름의 방향들 */
const DIRECTION_SUFFIXES = ['down', 'left', 'right', 'up'] as const;

/** 상태가 가리키는 애니메이션이 있는지: 그 이름이 있거나, 방향을 붙인 것이 하나라도 있으면 */
export function animatorAnimationExists(names: ReadonlySet<string>, animation: string): boolean {
  return names.has(animation) || DIRECTION_SUFFIXES.some((d) => names.has(`${animation}-${d}`));
}

/**
 * 상태에 고를 수 있는 애니메이션: 방향이 붙은 것은 방향을 뗀 이름으로 묶는다
 * (`walk-left`, `walk-right` → `walk`). 방향 없이 고르면 광장이 보는 방향을 붙여 찾는다.
 */
export function animatorAnimationChoices(names: Iterable<string>): string[] {
  const choices = new Set<string>();
  for (const name of names) {
    const match = /^(.+)-(down|left|right|up)$/.exec(name);
    choices.add(match ? match[1]! : name);
  }
  return [...choices].sort();
}

/** 파라미터 전부 (광장이 정하는 것 + 직접 만든 것) */
export function animatorParameters(
  animator: Pick<Animator, 'parameters'>,
): Map<string, { type: AnimatorParamType; builtin: boolean }> {
  const all = new Map<string, { type: AnimatorParamType; builtin: boolean }>();
  for (const p of BUILTIN_ANIMATOR_PARAMETERS) all.set(p.name, { type: p.type, builtin: true });
  for (const p of animator.parameters) {
    if (!all.has(p.name)) all.set(p.name, { type: p.type, builtin: false });
  }
  return all;
}

/** 애니메이터의 문제 (매니페스트 검증과 에디터가 함께 쓴다). 문제가 없으면 빈 배열 */
export function animatorProblems(
  animator: Animator,
  animationNames: ReadonlySet<string>,
): string[] {
  const problems: string[] = [];
  const states = new Set<string>();
  for (const state of animator.states) {
    if (states.has(state.name)) problems.push(`상태 이름 ${state.name}이(가) 겹칩니다.`);
    states.add(state.name);
    if (!animatorAnimationExists(animationNames, state.animation)) {
      problems.push(`${state.name} 상태의 애니메이션 ${state.animation}이(가) 없습니다.`);
    }
  }
  if (!states.has(animator.entry)) problems.push('시작 상태가 없습니다.');

  const builtin = new Set(BUILTIN_ANIMATOR_PARAMETERS.map((p) => p.name));
  const custom = new Set<string>();
  for (const parameter of animator.parameters) {
    if (builtin.has(parameter.name)) {
      problems.push(`${parameter.name}은(는) 광장이 쓰는 파라미터 이름입니다.`);
    } else if (custom.has(parameter.name)) {
      problems.push(`파라미터 이름 ${parameter.name}이(가) 겹칩니다.`);
    }
    custom.add(parameter.name);
    if (parameter.hold && parameter.type !== AnimatorParamType.Bool) {
      problems.push(`${parameter.name}: 누르는 동안 켜기는 불 값에만 씁니다.`);
    }
  }

  const params = animatorParameters(animator);
  animator.transitions.forEach((transition, i) => {
    const label = `${i + 1}번 전이 (${transition.from === ANY_STATE ? 'Any State' : transition.from} → ${transition.to})`;
    if (transition.from !== ANY_STATE && !states.has(transition.from)) {
      problems.push(`${label}: 출발 상태가 없습니다.`);
    }
    if (!states.has(transition.to)) problems.push(`${label}: 도착 상태가 없습니다.`);
    for (const condition of transition.conditions) {
      const param = params.get(condition.param);
      if (!param) problems.push(`${label}: 파라미터 ${condition.param}이(가) 없습니다.`);
      else if (param.type === AnimatorParamType.Trigger && condition.value !== undefined) {
        problems.push(`${label}: 트리거 조건에는 값을 적지 않습니다.`);
      }
    }
    // 조건도 "끝나면"도 없으면 매 프레임 바로 넘어가 버린다.
    if (transition.conditions.length === 0 && !transition.exitTime) {
      problems.push(`${label}: 조건을 달거나 "끝나면 넘어가기"를 켜야 합니다.`);
    }
  });
  return problems;
}

// ── 경고 (저장은 되지만 의도대로 돌지 않을 그래프) ──

/** 조건: 파라미터 → 값 (트리거는 true). 광장의 값끼리 따라오는 것(떨어지는 중이면 공중)을 넣어 둔다 */
function conditionValues(
  transition: AnimatorTransition,
  params: ReturnType<typeof animatorParameters>,
): Map<string, boolean> {
  const values = new Map<string, boolean>();
  for (const c of transition.conditions) {
    if (params.get(c.param)?.type === AnimatorParamType.Bool) values.set(c.param, c.value ?? true);
  }
  // falling이면 airborne, 땅에 있으면(airborne 거짓) falling도 거짓
  if (values.get('falling') === true && !values.has('airborne')) values.set('airborne', true);
  if (values.get('airborne') === false && !values.has('falling')) values.set('falling', false);
  return values;
}

/** 두 조건이 함께 맞을 수 있는지 (같은 불 값을 서로 반대로 요구하지 않으면) */
function compatible(a: Map<string, boolean>, b: Map<string, boolean>): boolean {
  for (const [param, value] of a) {
    if (b.has(param) && b.get(param) !== value) return false;
  }
  return true;
}

/**
 * 저장은 되지만 광장에서 의도대로 돌지 않을 그래프를 알려 준다:
 * - Any State에서 불 값 조건만으로 들어가는 상태 X가, 그 조건이 여전히 맞는 채로 다른 상태 Y로 넘어가면
 *   Y에서 Any State가 다시 X로 끌어와 둘을 매 프레임 오간다 (애니메이션이 첫 프레임에 멈춘 것처럼 보임).
 *   예: Any → jump (airborne), Any → fall (falling)이면 떨어지는 동안 jump ↔ fall.
 * - 나가는 전이가 없는 상태 (Any State 전이로만 빠져나온다: 착지해도 그 모습에 머묾)
 * - 들어오는 전이가 없는 상태 (시작 상태가 아니면 한 번도 틀지 않는다)
 */
export function animatorWarnings(animator: Animator): string[] {
  const warnings: string[] = [];
  const params = animatorParameters(animator);
  const byName = new Map(animator.states.map((s) => [s.name, s]));
  const reported = new Set<string>();
  for (const pull of animator.transitions) {
    if (pull.from !== ANY_STATE || !byName.has(pull.to)) continue;
    // 트리거가 있으면 한 번 쓰고 사라지므로 다시 끌어오지 않는다
    if (pull.conditions.some((c) => params.get(c.param)?.type !== AnimatorParamType.Bool)) continue;
    if (pull.conditions.length === 0) continue;
    const held = conditionValues(pull, params);
    for (const leave of animator.transitions) {
      const leavesTarget =
        (leave.from === pull.to || (leave.from === ANY_STATE && leave !== pull)) &&
        leave.to !== pull.to;
      if (!leavesTarget || !byName.has(leave.to)) continue;
      // 트리거로 나가는 것은 한 번 잠깐 끊길 뿐 계속 오가지는 않는다 (공중에서 첨부를 보내면 emote가 바로 끊기는 정도)
      if (leave.conditions.some((c) => params.get(c.param)?.type !== AnimatorParamType.Bool))
        continue;
      // 나간 곳이 Any State 전이로 끊기지 않는 상태면 끌려오지 않는다
      if (byName.get(leave.to)!.noInterrupt) continue;
      if (!compatible(held, conditionValues(leave, params))) continue;
      const key = [pull.to, leave.to].sort().join('|');
      if (reported.has(key)) continue;
      reported.add(key);
      warnings.push(
        `${pull.to} ↔ ${leave.to}: ${leave.to}(으)로 넘어간 뒤에도 Any State → ${pull.to}의 조건이 맞아서 두 상태를 계속 오갑니다 (첫 프레임에 멈춘 것처럼 보임). Any State → ${pull.to}에 반대 조건을 더하거나(예: falling 거짓), ${leave.to}의 "Any State 전이로 끊기지 않기"를 켜세요.`,
      );
    }
  }
  for (const state of animator.states) {
    const outgoing = animator.transitions.some((t) => t.from === state.name);
    if (!outgoing) {
      warnings.push(
        `${state.name} 상태에서 나가는 전이가 없습니다 (Any State 전이로만 빠져나옵니다).`,
      );
    }
    const incoming = animator.transitions.some((t) => t.to === state.name);
    if (!incoming && state.name !== animator.entry) {
      warnings.push(`${state.name} 상태로 들어오는 전이가 없어 틀 일이 없습니다.`);
    }
  }
  return warnings;
}

// ── 재생 ──

/**
 * 당긴 트리거는 이만큼 기다렸다가 아무 전이도 쓰지 않으면 버린다. 다만 지금 상태(또는 Any State)에서
 * 그 트리거를 조건으로 "끝나면 넘어가기" 전이가 애니메이션이 끝나기를 기다리는 동안은 버리지 않고, 끝난
 * 뒤로 이만큼 더 둔다 (예전엔 0.5초보다 긴 애니메이션이면 끝나기 전에 트리거가 사라져 넘어가지 않았다).
 */
export const TRIGGER_HOLD_MS = 500;
/** 한 번에 이어서 넘어갈 수 있는 전이 수 (조건이 서로 맞물려도 멈추게) */
const MAX_HOPS = 8;

/** 한 캐릭터의 애니메이터 상태 (화면마다 따로 둔다) */
export interface AnimatorRuntime {
  state: string;
  /** 지금 상태에 들어간 시각 */
  since: number;
  bools: Map<string, boolean>;
  /** 당긴 트리거와 당긴 시각 */
  triggers: Map<string, number>;
}

export function startAnimator(animator: Animator, now: number): AnimatorRuntime {
  return { state: animator.entry, since: now, bools: new Map(), triggers: new Map() };
}

export function fireTrigger(runtime: AnimatorRuntime, name: string, now: number): void {
  runtime.triggers.set(name, now);
}

export function setAnimatorBool(runtime: AnimatorRuntime, name: string, value: boolean): void {
  runtime.bools.set(name, value);
}

function satisfied(
  transition: AnimatorTransition,
  runtime: AnimatorRuntime,
  params: ReturnType<typeof animatorParameters>,
): boolean {
  return transition.conditions.every((condition) => {
    const param = params.get(condition.param);
    if (!param) return false;
    if (param.type === AnimatorParamType.Trigger) return runtime.triggers.has(condition.param);
    return (runtime.bools.get(condition.param) ?? false) === (condition.value ?? true);
  });
}

/**
 * 지금 상태의 애니메이션이 끝나기를 기다리는 "끝나면 넘어가기" 전이가 조건으로 쓰는 트리거. 끝난 뒤에도
 * TRIGGER_HOLD_MS 동안은 남긴다 (끝나는 그 순간의 걸음에서 쓸 수 있게, 다른 조건을 잠깐 기다릴 수 있게).
 */
function awaitedTriggers(
  animator: Animator,
  runtime: AnimatorRuntime,
  params: ReturnType<typeof animatorParameters>,
  now: number,
  cycleMs: (state: AnimatorState) => number,
  byName: ReadonlyMap<string, AnimatorState>,
): Set<string> {
  const waiting = new Set<string>();
  const current = byName.get(runtime.state);
  if (!current || now - runtime.since > cycleMs(current) + TRIGGER_HOLD_MS) return waiting;
  for (const t of animator.transitions) {
    if (!t.exitTime || (t.from !== runtime.state && t.from !== ANY_STATE)) continue;
    if (t.from === ANY_STATE && current.noInterrupt) continue;
    for (const c of t.conditions) {
      if (params.get(c.param)?.type === AnimatorParamType.Trigger) waiting.add(c.param);
    }
  }
  return waiting;
}

/**
 * 조건을 보고 상태를 옮긴다. 넘어갔으면 true.
 * cycleMs(state)는 그 상태의 애니메이션이 한 번 도는 시간이다 ("끝나면 넘어가기"에 쓴다).
 * Any State에서 지금 상태로 가는 전이는 트리거가 있을 때만 쓴다 (불 값 조건이면 매 프레임 처음부터 다시
 * 틀게 되므로). 같은 상태 안에서는 Any State 전이를 먼저 본다 (유니티와 같음).
 */
export function stepAnimator(
  animator: Animator,
  runtime: AnimatorRuntime,
  now: number,
  baseCycleMs: (state: AnimatorState) => number,
): boolean {
  // 상태의 재생 속도만큼 한 바퀴가 짧아지거나 길어진다
  const cycleMs = (state: AnimatorState) => baseCycleMs(state) / animatorStateSpeed(state);
  const params = animatorParameters(animator);
  const byName = new Map(animator.states.map((s) => [s.name, s]));
  if (!byName.has(runtime.state)) {
    runtime.state = animator.entry;
    runtime.since = now;
  }
  const waiting = awaitedTriggers(animator, runtime, params, now, cycleMs, byName);
  for (const [name, at] of runtime.triggers) {
    if (now - at > TRIGGER_HOLD_MS && !waiting.has(name)) runtime.triggers.delete(name);
  }
  let changed = false;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const current = byName.get(runtime.state);
    if (!current) break;
    const elapsed = now - runtime.since;
    const cycle = cycleMs(current);
    const candidates = [
      // 끊기지 않는 상태(콤보 등)에서는 Any State 전이를 보지 않는다
      ...(current.noInterrupt
        ? []
        : animator.transitions.filter(
            (t) =>
              t.from === ANY_STATE &&
              (t.to !== runtime.state ||
                t.conditions.some((c) => params.get(c.param)?.type === AnimatorParamType.Trigger)),
          )),
      ...animator.transitions.filter((t) => t.from === runtime.state),
    ];
    const next = candidates.find(
      (t) =>
        byName.has(t.to) &&
        // 조건이 없는 전이는 "끝나면"으로 본다 (검증이 막지만, 예전 데이터에서도 멈추지 않게)
        ((t.exitTime ?? false) || t.conditions.length === 0
          ? elapsed >= cycle * (t.exitAt ?? 1)
          : true) &&
        satisfied(t, runtime, params),
    );
    if (!next) break;
    for (const condition of next.conditions) runtime.triggers.delete(condition.param);
    runtime.state = next.to;
    runtime.since = now;
    changed = true;
  }
  return changed;
}

/** 상태의 재생 속도 (배). 없거나 범위 밖이면 1 */
export function animatorStateSpeed(state: Pick<AnimatorState, 'speed'>): number {
  const speed = state.speed ?? 1;
  return speed >= ANIMATOR_SPEED_MIN && speed <= ANIMATOR_SPEED_MAX ? speed : 1;
}

/** 지금 상태가 이동을 막는지 (기술을 쓰는 동안 등) */
export function animatorLocksMovement(animator: Animator, runtime: AnimatorRuntime): boolean {
  return animator.states.some((s) => s.name === runtime.state && s.lockMove);
}

/**
 * 예전 규칙(대기·걷기·점프·첨부 모션)과 똑같이 도는 그래프. 에디터의 "기본 그래프로 시작"이 만든다.
 * 점프는 그 애니메이션이 있을 때만 넣는다 (없으면 광장이 걷기의 두 번째 프레임을 쓰는 것과 달라지므로).
 * 첨부 모션도 있을 때만 넣는다 (없으면 광장은 제자리에서 뛰기만 한다).
 */
export function defaultAnimator(animationNames: ReadonlySet<string>): Animator {
  const hasJump = animatorAnimationExists(animationNames, 'jump');
  const hasEmote = animatorAnimationExists(animationNames, 'emote');
  const states: AnimatorState[] = [
    { name: 'idle', animation: 'idle', x: 0, y: 0 },
    { name: 'walk', animation: 'walk', x: 240, y: 0 },
    ...(hasJump ? [{ name: 'jump', animation: 'jump', loop: false, x: 240, y: 160 }] : []),
    ...(hasEmote ? [{ name: 'emote', animation: 'emote', loop: false, x: 0, y: 160 }] : []),
  ];
  const transitions: AnimatorTransition[] = [
    { from: 'idle', to: 'walk', conditions: [{ param: 'moving', value: true }] },
    { from: 'walk', to: 'idle', conditions: [{ param: 'moving', value: false }] },
    ...(hasJump
      ? [
          { from: ANY_STATE, to: 'jump', conditions: [{ param: 'airborne', value: true }] },
          { from: 'jump', to: 'idle', conditions: [{ param: 'airborne', value: false }] },
        ]
      : []),
    ...(hasEmote
      ? [
          { from: ANY_STATE, to: 'emote', conditions: [{ param: 'emote' }] },
          { from: 'emote', to: 'idle', conditions: [], exitTime: true },
        ]
      : []),
  ];
  return { entry: 'idle', states, parameters: [], transitions };
}
