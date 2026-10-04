import {
  ANIMATOR_CONDITION_LIMIT,
  ANIMATOR_PARAMETER_LIMIT,
  ANIMATOR_STATE_LIMIT,
  ANIMATOR_TRANSITION_LIMIT,
  ANY_STATE,
  ASSET_NAME_PATTERN,
  type AnimatorParameter,
  type Animator,
  type AnimatorCondition,
  AnimatorParamType,
  type AnimatorRuntime,
  type AnimatorState,
  type AnimatorTransition,
  type AssetAnimation,
  BUILTIN_ANIMATOR_PARAMETERS,
  MOTION_LABEL_MAX_LENGTH,
  SUGGESTED_KEYS,
  PlazaStyle,
  animatorAnimationChoices,
  animatorAnimationExists,
  animatorClip,
  animatorParameters,
  animatorLocksMovement,
  animatorProblems,
  animatorStateSpeed,
  animatorWarnings,
  defaultAnimator,
  fireTrigger,
  setAnimatorBool,
  startAnimator,
  stepAnimator,
} from '@metacode/shared';
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { isKeyboardClaimed } from '../../ui/keyboardClaim';
import { KeyCapture } from '../../ui/KeyCapture';
import { Select } from '../../ui/Select';
import { NODE_H, NODE_W, type SkillKind, addSkill, freeName, snap } from './animatorSkills';
import { type EditorAnimation, type PixelDocument, usedMotionKeys } from '@metacode/client';
import { frameCanvas } from './pixelCanvas';
import {
  ArrowDown,
  ArrowUp,
  CircleHelp,
  ImagePlus,
  Link2,
  Plus,
  RotateCcw,
  Swords,
  Trash2,
  X,
} from 'lucide-react';

/** 같은 두 상태 사이의 전이 화살표 간격 */
const EDGE_GAP = 12;

type Selection =
  { kind: 'state'; name: string } | { kind: 'transition'; index: number } | { kind: 'any' } | null;

const DIRECTIONS = [
  { id: 'down', label: '아래' },
  { id: 'left', label: '왼쪽' },
  { id: 'right', label: '오른쪽' },
  { id: 'up', label: '위' },
] as const;
type Dir = (typeof DIRECTIONS)[number]['id'];

/** 재생 속도 고르기 */
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
/** "끝나면 넘어가기"의 지점 고르기 (애니메이션 한 바퀴의 %) */
const EXIT_POINTS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

/** 상태 상자 아래 줄: 애니메이션과 옵션 */
function stateDetail(state: AnimatorState): string {
  const parts = [state.animation];
  if (state.loop === false) parts.push('한 번');
  if (animatorStateSpeed(state) !== 1) parts.push(`×${animatorStateSpeed(state)}`);
  if (state.lockMove) parts.push('이동 막음');
  return parts.join(' · ');
}

/**
 * 새 애니메이션마다 그것을 트는 상태를 더한 애니메이터 (GIF로 상태 추가). 상태 이름은 애니메이션 이름에서
 * (겹치면 -2, -3 …), 자리는 지금 상태들 아래에 한 줄로. 상태 한도를 넘는 것은 더하지 않는다.
 */
export function withStatesFor(animator: Animator, animations: readonly string[]): Animator {
  const used = new Set(animator.states.map((s) => s.name));
  const left = Math.min(...animator.states.map((s) => s.x));
  const top = Math.max(...animator.states.map((s) => s.y)) + NODE_H + 72;
  const added: AnimatorState[] = [];
  for (const animation of animations) {
    if (animator.states.length + added.length >= ANIMATOR_STATE_LIMIT) break;
    const name = freeName(animation, used);
    used.add(name);
    added.push({ name, animation, x: snap(left + added.length * (NODE_W + 40)), y: snap(top) });
  }
  return { ...animator, states: [...animator.states, ...added] };
}

/** 전이에 붙일 짧은 설명 (그래프의 화살표 옆) */
function conditionText(transition: AnimatorTransition): string {
  const parts = transition.conditions.map((c) => (c.value === false ? `!${c.param}` : c.param));
  if (transition.exitTime) {
    parts.push(
      transition.exitAt && transition.exitAt < 1
        ? `${Math.round(transition.exitAt * 100)}%`
        : '끝나면',
    );
  }
  return parts.join(' · ');
}

/**
 * 캐릭터 애니메이터 편집기 (유니티 Animator처럼): 가운데 상태 그래프, 왼쪽 파라미터, 오른쪽 고른 것의 설정과
 * 미리보기. 고칠 때마다 PixelDocument.setAnimator로 새 애니메이터를 넘긴다 (되돌리기 가능).
 */
export function AnimatorEditor({
  editor,
  onClose,
  onAddFromGif,
}: {
  editor: PixelDocument;
  onClose(): void;
  /** GIF를 골라 새 애니메이션과 그것을 트는 상태를 만든다 (모션을 따로 만들지 않아도) */
  onAddFromGif(): void;
}) {
  const { doc } = editor;
  const animator = doc.animator;
  // 그릴 때마다 센다: 에디터는 애니메이션 목록을 그 자리에서 고치므로(GIF로 상태 추가 등) 배열로 memo하면
  // 새 애니메이션을 못 보고 "없는 애니메이션"으로 잡았다.
  const names = new Set(doc.animations.map((a) => a.name));
  const [guide, setGuide] = useState(false);

  if (!animator) {
    return (
      <section className="animator-editor animator-editor--empty" aria-label="애니메이터">
        <div className="animator-editor__intro">
          <h2>애니메이터</h2>
          <p>광장에서 언제 어떤 애니메이션을 틀지 상태와 전이로 정합니다.</p>
          <div className="animator-editor__row">
            <button
              type="button"
              className="button button--primary"
              onClick={() => editor.setAnimator(defaultAnimator(names))}
            >
              기본 그래프로 시작
            </button>
            <button
              type="button"
              className="button"
              onClick={() =>
                editor.setAnimator({
                  entry: 'idle',
                  states: [{ name: 'idle', animation: 'idle', x: 0, y: 0 }],
                  parameters: [],
                  transitions: [],
                })
              }
            >
              빈 그래프로 시작
            </button>
            <button type="button" className="button" onClick={() => setGuide(true)}>
              <CircleHelp aria-hidden /> 애니메이터가 처음이라면
            </button>
            <button type="button" className="button" onClick={onClose}>
              닫기
            </button>
          </div>
        </div>
        {guide && <AnimatorGuide onClose={() => setGuide(false)} />}
      </section>
    );
  }
  return (
    <AnimatorGraph
      editor={editor}
      animator={animator}
      names={names}
      onClose={onClose}
      onAddFromGif={onAddFromGif}
    />
  );
}

function AnimatorGraph({
  editor,
  animator,
  names,
  onClose,
  onAddFromGif,
}: {
  editor: PixelDocument;
  animator: Animator;
  names: ReadonlySet<string>;
  onClose(): void;
  onAddFromGif(): void;
}) {
  const [selection, setSelection] = useState<Selection>(null);
  /** 전이를 만드는 중: 출발 상태 (Any State면 *) */
  const [linking, setLinking] = useState<string | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [offset, setOffset] = useState(() => {
    const minX = Math.min(...animator.states.map((s) => s.x));
    const minY = Math.min(...animator.states.map((s) => s.y));
    return { x: 260 - minX, y: 80 - minY };
  });
  /**
   * Any State 상자 자리: 애니메이터에 저장한 자리, 없으면(예전에 만든 그래프) 처음 연 때의 상태들 왼쪽.
   * 끌면 애니메이터에 저장한다 (예전엔 저장하지 않아 다시 열면 늘 처음 자리로 돌아갔다).
   */
  const [fallbackAny] = useState(() => ({
    x: snap(Math.min(...animator.states.map((s) => s.x)) - 220),
    y: snap(Math.min(...animator.states.map((s) => s.y))),
  }));
  const anyAt = animator.anyState ?? fallbackAny;
  const drag = useRef<
    | {
        kind: 'state';
        name: string;
        start: { x: number; y: number };
        from: { x: number; y: number };
        /** 끌기 한 번 = 되돌리기 한 단계 (같은 상태를 다시 끌면 따로 되돌린다) */
        id: number;
      }
    | {
        kind: 'any';
        start: { x: number; y: number };
        from: { x: number; y: number };
        id: number;
      }
    | { kind: 'pan'; start: { x: number; y: number }; from: { x: number; y: number } }
    | null
  >(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragSeq = useRef(0);
  const [runtimeState, setRuntimeState] = useState<string | null>(null);
  /** 떠 있는 창: 도움말, 스킬 만들기 */
  const [dialog, setDialog] = useState<'guide' | 'skill' | null>(null);
  /** 미리보기와 고른 상태의 애니메이션이 함께 쓰는 보는 방향 */
  const [dir, setDir] = useState<Dir>(
    editor.doc.style === PlazaStyle.SideScroll ? 'right' : 'down',
  );

  const commit = (next: Animator, key?: string) => editor.setAnimator(next, key);
  const problems = animatorProblems(animator, names);
  const warnings = animatorWarnings(animator);
  const params = animatorParameters(animator);
  const byName = new Map(animator.states.map((s) => [s.name, s]));
  const choices = animatorAnimationChoices(names);
  const usedKeys = usedMotionKeys(editor.doc);

  // ── 좌표 ──
  const graphPoint = (e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left - offset.x, y: e.clientY - rect.top - offset.y };
  };
  const nodeAt = (name: string) =>
    name === ANY_STATE ? anyAt : (byName.get(name) ?? { x: 0, y: 0 });

  // ── 고치기 ──
  const updateState = (name: string, change: Partial<AnimatorState>, key?: string) =>
    commit(
      {
        ...animator,
        states: animator.states.map((s) => (s.name === name ? { ...s, ...change } : s)),
      },
      key,
    );

  const renameState = (from: string, to: string) => {
    if (from === to || !ASSET_NAME_PATTERN.test(to) || byName.has(to)) return false;
    commit({
      ...animator,
      entry: animator.entry === from ? to : animator.entry,
      states: animator.states.map((s) => (s.name === from ? { ...s, name: to } : s)),
      transitions: animator.transitions.map((t) => ({
        ...t,
        from: t.from === from ? to : t.from,
        to: t.to === from ? to : t.to,
      })),
    });
    setSelection({ kind: 'state', name: to });
    return true;
  };

  const removeState = (name: string) => {
    const states = animator.states.filter((s) => s.name !== name);
    if (states.length === 0) return;
    commit({
      ...animator,
      entry: animator.entry === name ? states[0]!.name : animator.entry,
      states,
      transitions: animator.transitions.filter((t) => t.from !== name && t.to !== name),
    });
    setSelection(null);
  };

  const addState = () => {
    if (animator.states.length >= ANIMATOR_STATE_LIMIT) return;
    const name = freeName('state', new Set(byName.keys()));
    const rect = svgRef.current?.getBoundingClientRect();
    const x = snap((rect ? rect.width / 2 : 300) - offset.x - NODE_W / 2);
    const y = snap((rect ? rect.height / 2 : 200) - offset.y - NODE_H / 2);
    commit({
      ...animator,
      states: [...animator.states, { name, animation: choices[0] ?? 'idle', x, y }],
    });
    setSelection({ kind: 'state', name });
  };

  const addTransition = (from: string, to: string) => {
    if (animator.transitions.length >= ANIMATOR_TRANSITION_LIMIT) return;
    // Any State에서 나가는 전이는 조건이 있어야 하므로 첫 트리거로 시작한다.
    const firstTrigger = [...params].find(([, p]) => p.type === AnimatorParamType.Trigger)?.[0];
    const transition: AnimatorTransition =
      from === ANY_STATE && firstTrigger
        ? { from, to, conditions: [{ param: firstTrigger }] }
        : { from, to, conditions: [], exitTime: true };
    commit({ ...animator, transitions: [...animator.transitions, transition] });
    setSelection({ kind: 'transition', index: animator.transitions.length });
  };

  const updateTransition = (index: number, change: Partial<AnimatorTransition>) =>
    commit({
      ...animator,
      transitions: animator.transitions.map((t, i) => (i === index ? { ...t, ...change } : t)),
    });

  const removeTransition = (index: number) => {
    commit({ ...animator, transitions: animator.transitions.filter((_, i) => i !== index) });
    setSelection(null);
  };

  /** 같은 출발 상태의 전이 사이에서 순서(먼저 보는 것)를 바꾼다 */
  const moveTransition = (index: number, step: -1 | 1) => {
    const from = animator.transitions[index]!.from;
    const same = animator.transitions
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => t.from === from)
      .map(({ i }) => i);
    const at = same.indexOf(index);
    const other = same[at + step];
    if (other === undefined) return;
    const transitions = [...animator.transitions];
    [transitions[index], transitions[other]] = [transitions[other]!, transitions[index]!];
    commit({ ...animator, transitions });
    setSelection({ kind: 'transition', index: other });
  };

  // ── 끌기 ──
  const onNodeDown = (e: ReactPointerEvent, name: string) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    if (linking !== null) {
      if (name !== ANY_STATE) addTransition(linking, name);
      setLinking(null);
      return;
    }
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setSelection(name === ANY_STATE ? { kind: 'any' } : { kind: 'state', name });
    const at = nodeAt(name);
    drag.current =
      name === ANY_STATE
        ? {
            kind: 'any',
            start: { x: e.clientX, y: e.clientY },
            from: { ...at },
            id: ++dragSeq.current,
          }
        : {
            kind: 'state',
            name,
            start: { x: e.clientX, y: e.clientY },
            from: { x: at.x, y: at.y },
            id: ++dragSeq.current,
          };
  };

  const onBackgroundDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    if (linking !== null) {
      setLinking(null);
      return;
    }
    setSelection(null);
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { kind: 'pan', start: { x: e.clientX, y: e.clientY }, from: { ...offset } };
  };

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (linking !== null) setPointer(graphPoint(e));
    const current = drag.current;
    if (!current) return;
    const dx = e.clientX - current.start.x;
    const dy = e.clientY - current.start.y;
    if (current.kind === 'pan') {
      setOffset({ x: current.from.x + dx, y: current.from.y + dy });
    } else if (current.kind === 'any') {
      const x = snap(current.from.x + dx);
      const y = snap(current.from.y + dy);
      if (x !== anyAt.x || y !== anyAt.y) {
        commit({ ...animator, anyState: { x, y } }, `move:${ANY_STATE}:${current.id}`);
      }
    } else {
      const x = snap(current.from.x + dx);
      const y = snap(current.from.y + dy);
      const state = byName.get(current.name);
      if (state && (state.x !== x || state.y !== y)) {
        updateState(current.name, { x, y }, `move:${current.name}:${current.id}`);
      }
    }
  };

  const endDrag = () => {
    drag.current = null;
  };

  // ── 화살표 ──
  const edges = useMemo(() => {
    const pairCount = new Map<string, number>();
    const pairIndex: number[] = [];
    animator.transitions.forEach((t) => {
      const key = [t.from, t.to].sort().join('>');
      const n = pairCount.get(key) ?? 0;
      pairIndex.push(n);
      pairCount.set(key, n + 1);
    });
    return animator.transitions.map((t, i) => {
      const key = [t.from, t.to].sort().join('>');
      const count = pairCount.get(key)!;
      return { transition: t, index: i, slot: pairIndex[i]! - (count - 1) / 2 };
    });
  }, [animator.transitions]);

  const center = (name: string) => {
    const at = nodeAt(name);
    return { x: at.x + NODE_W / 2, y: at.y + NODE_H / 2 };
  };

  /** 상자 테두리에서 끊기는 화살표 (같은 두 상태 사이는 옆으로 비켜서) */
  const edgePath = (from: string, to: string, slot: number) => {
    const a = center(from);
    const b = center(to);
    if (from === to) {
      const x = a.x + NODE_W / 2 - 16;
      const y = a.y - NODE_H / 2;
      return {
        d: `M ${x - 18} ${y} C ${x - 18} ${y - 40}, ${x + 18} ${y - 40}, ${x + 18} ${y}`,
        mid: { x, y: y - 32 },
      };
    }
    // 두 상태의 순서와 상관없이 같은 쪽을 기준으로 비켜야 서로 겹치지 않는다
    const [p, q] = [from, to].sort() as [string, string];
    const pa = center(p);
    const pb = center(q);
    const len = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
    const nx = -(pb.y - pa.y) / len;
    const ny = (pb.x - pa.x) / len;
    const ox = nx * slot * EDGE_GAP;
    const oy = ny * slot * EDGE_GAP;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const clip = (c: { x: number; y: number }, sign: number) => {
      const t = Math.min(
        dx === 0 ? Infinity : NODE_W / 2 / Math.abs(dx),
        dy === 0 ? Infinity : NODE_H / 2 / Math.abs(dy),
      );
      return { x: c.x + sign * dx * t + ox, y: c.y + sign * dy * t + oy };
    };
    const start = clip(a, 1);
    const end = clip(b, -1);
    return {
      d: `M ${start.x} ${start.y} L ${end.x} ${end.y}`,
      mid: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
    };
  };

  const selectedState = selection?.kind === 'state' ? byName.get(selection.name) : undefined;
  const selectedTransition =
    selection?.kind === 'transition' ? animator.transitions[selection.index] : undefined;

  return (
    <section className="animator-editor" aria-label="애니메이터">
      <div className="animator-editor__toolbar">
        <button
          type="button"
          className="icon-button animator-editor__help"
          aria-label="애니메이터 도움말"
          title="도움말"
          onClick={() => setDialog('guide')}
        >
          <CircleHelp aria-hidden />
        </button>
        <h2>애니메이터</h2>
        <button
          type="button"
          className="button"
          disabled={animator.states.length >= ANIMATOR_STATE_LIMIT}
          onClick={addState}
        >
          <Plus aria-hidden /> 상태
        </button>
        <button
          type="button"
          className="button"
          disabled={animator.states.length >= ANIMATOR_STATE_LIMIT || !editor.canAddAnimation()}
          title="GIF로 상태 만들기"
          onClick={onAddFromGif}
        >
          <ImagePlus aria-hidden /> GIF로 상태
        </button>
        <button
          type="button"
          className="button"
          disabled={
            animator.states.length >= ANIMATOR_STATE_LIMIT ||
            animator.parameters.length >= ANIMATOR_PARAMETER_LIMIT
          }
          title="기술·콤보·모아 쏘기 만들기"
          onClick={() => setDialog('skill')}
        >
          <Swords aria-hidden /> 스킬 만들기
        </button>
        <button
          type="button"
          className="button"
          aria-pressed={linking !== null}
          disabled={!selection || selection.kind === 'transition'}
          title="고른 상태에서 화살표 만들기"
          onClick={() =>
            setLinking(
              selection?.kind === 'any'
                ? ANY_STATE
                : selection?.kind === 'state'
                  ? selection.name
                  : null,
            )
          }
        >
          <Link2 aria-hidden /> 전이 만들기
        </button>
        {linking !== null && <span className="form__hint">이어 줄 상태를 누르세요</span>}
        <span className="animator-editor__spacer" />
        <button
          type="button"
          className="button button--danger"
          onClick={() => {
            if (window.confirm('애니메이터를 없앨까요?')) {
              editor.setAnimator(undefined);
            }
          }}
        >
          애니메이터 없애기
        </button>
        <button type="button" className="button" onClick={onClose} title="Esc">
          그림으로 돌아가기
        </button>
      </div>

      <aside className="animator-editor__params" aria-label="파라미터">
        <h3>파라미터</h3>
        <ul className="animator-editor__param-list">
          {BUILTIN_ANIMATOR_PARAMETERS.map((p) => (
            <li key={p.name} title="광장이 정하는 값">
              <span className="animator-editor__type" data-type={p.type}>
                {p.type === AnimatorParamType.Trigger ? '트리거' : '불 값'}
              </span>
              <code>{p.name}</code>
              <small>{p.label}</small>
            </li>
          ))}
        </ul>
        <h4>직접 만든 것</h4>
        {animator.parameters.length === 0 && <p className="form__hint">없음</p>}
        <ul className="animator-editor__custom">
          {animator.parameters.map((p, i) => (
            <ParameterRow
              // 이름으로 묶는다: 번호로 묶으면 위의 파라미터를 지웠을 때 아래 줄의 이름 칸이 지운 파라미터의
              // 이름을 들고 있다가, 포커스가 빠질 때 아래 파라미터를 그 이름으로 바꿨다.
              key={p.name}
              parameter={p}
              usedKeys={usedKeys}
              taken={(name) => params.has(name) && name !== p.name}
              onChange={(next, key) =>
                commit(
                  {
                    ...animator,
                    parameters: animator.parameters.map((q, j) => (j === i ? next : q)),
                    // 이름을 바꾸면 그 파라미터를 쓰는 조건도 함께 바꾼다
                    transitions:
                      next.name === p.name
                        ? animator.transitions
                        : animator.transitions.map((t) => ({
                            ...t,
                            conditions: t.conditions.map((c) =>
                              c.param === p.name ? { ...c, param: next.name } : c,
                            ),
                          })),
                  },
                  key,
                )
              }
              onRemove={() =>
                commit({
                  ...animator,
                  parameters: animator.parameters.filter((_, j) => j !== i),
                  transitions: animator.transitions.map((t) => ({
                    ...t,
                    conditions: t.conditions.filter((c) => c.param !== p.name),
                  })),
                })
              }
            />
          ))}
        </ul>
        <div className="animator-editor__row">
          {([AnimatorParamType.Trigger, AnimatorParamType.Bool] as const).map((type) => (
            <button
              key={type}
              type="button"
              className="button"
              disabled={animator.parameters.length >= ANIMATOR_PARAMETER_LIMIT}
              onClick={() =>
                commit({
                  ...animator,
                  parameters: [
                    ...animator.parameters,
                    {
                      name: freeName(
                        type === AnimatorParamType.Trigger ? 'trigger' : 'flag',
                        new Set(params.keys()),
                      ),
                      type,
                    },
                  ],
                })
              }
            >
              <Plus aria-hidden /> {type === AnimatorParamType.Trigger ? '트리거' : '불 값'}
            </button>
          ))}
        </div>
        {problems.length > 0 && (
          <div className="animator-editor__problems" role="alert">
            <strong>저장하려면 고쳐야 합니다</strong>
            <ul>
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}
        {warnings.length > 0 && (
          <div className="animator-editor__warnings" role="status">
            <strong>저장은 되지만 의도대로 돌지 않을 수 있습니다</strong>
            <ul>
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </aside>

      <div className="animator-editor__graph">
        <svg
          ref={svgRef}
          onPointerDown={onBackgroundDown}
          onPointerMove={onMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          data-linking={linking !== null || undefined}
          aria-label="상태 그래프"
        >
          <defs>
            <marker
              id="animator-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="8"
              markerHeight="8"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="animator-editor__arrowhead" />
            </marker>
          </defs>
          <g transform={`translate(${offset.x} ${offset.y})`}>
            {edges.map(({ transition, index, slot }) => {
              if (transition.from !== ANY_STATE && !byName.has(transition.from)) return null;
              if (!byName.has(transition.to)) return null;
              const { d, mid } = edgePath(transition.from, transition.to, slot);
              const selected = selection?.kind === 'transition' && selection.index === index;
              return (
                <g
                  key={index}
                  className="animator-editor__edge"
                  data-selected={selected || undefined}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setLinking(null);
                    setSelection({ kind: 'transition', index });
                  }}
                >
                  <path d={d} className="animator-editor__edge-hit" />
                  <path
                    d={d}
                    className="animator-editor__edge-line"
                    markerEnd="url(#animator-arrow)"
                  />
                  <text x={mid.x} y={mid.y - 4} textAnchor="middle">
                    {conditionText(transition)}
                  </text>
                </g>
              );
            })}
            {linking !== null && pointer && (
              <line
                className="animator-editor__linking"
                x1={center(linking).x}
                y1={center(linking).y}
                x2={pointer.x}
                y2={pointer.y}
              />
            )}
            <g
              className="animator-editor__node animator-editor__node--any"
              data-selected={selection?.kind === 'any' || undefined}
              transform={`translate(${anyAt.x} ${anyAt.y})`}
              onPointerDown={(e) => onNodeDown(e, ANY_STATE)}
            >
              <rect width={NODE_W} height={NODE_H} rx={8} />
              <text x={12} y={29}>
                Any State
              </text>
            </g>
            {animator.states.map((state) => (
              <g
                key={state.name}
                className="animator-editor__node"
                data-selected={
                  (selection?.kind === 'state' && selection.name === state.name) || undefined
                }
                data-entry={state.name === animator.entry || undefined}
                data-running={state.name === runtimeState || undefined}
                data-missing={!animatorAnimationExists(names, state.animation) || undefined}
                transform={`translate(${state.x} ${state.y})`}
                onPointerDown={(e) => onNodeDown(e, state.name)}
              >
                <rect width={NODE_W} height={NODE_H} rx={8} />
                <text x={12} y={20} className="animator-editor__node-name">
                  {state.name}
                </text>
                <text x={12} y={37} className="animator-editor__node-anim">
                  {stateDetail(state)}
                </text>
                {state.name === animator.entry && (
                  <text
                    x={NODE_W - 10}
                    y={20}
                    textAnchor="end"
                    className="animator-editor__node-entry"
                  >
                    시작
                  </text>
                )}
              </g>
            ))}
          </g>
        </svg>
      </div>

      <aside className="animator-editor__inspector" aria-label="설정">
        {selectedState ? (
          <StateInspector
            key={selectedState.name}
            editor={editor}
            dir={dir}
            state={selectedState}
            entry={animator.entry === selectedState.name}
            choices={choices}
            canRemove={animator.states.length > 1}
            transitions={edges.filter((e) => e.transition.from === selectedState.name)}
            onRename={(to) => renameState(selectedState.name, to)}
            onChange={(change, key) => updateState(selectedState.name, change, key)}
            onEntry={() => commit({ ...animator, entry: selectedState.name })}
            onLink={() => setLinking(selectedState.name)}
            onRemove={() => removeState(selectedState.name)}
            onSelectTransition={(index) => setSelection({ kind: 'transition', index })}
          />
        ) : selection?.kind === 'any' ? (
          <section>
            <h3>Any State</h3>
            <p className="form__hint">어느 상태에서든 조건이 맞으면 넘어갑니다.</p>
            <button type="button" className="button" onClick={() => setLinking(ANY_STATE)}>
              <Link2 aria-hidden /> 여기서 전이 만들기
            </button>
            <TransitionList
              items={edges.filter((e) => e.transition.from === ANY_STATE)}
              onSelect={(index) => setSelection({ kind: 'transition', index })}
            />
          </section>
        ) : selectedTransition && selection?.kind === 'transition' ? (
          <TransitionInspector
            transition={selectedTransition}
            params={params}
            onChange={(change) => updateTransition(selection.index, change)}
            onMove={(step) => moveTransition(selection.index, step)}
            onRemove={() => removeTransition(selection.index)}
          />
        ) : (
          <section>
            <h3>그래프</h3>
            <p className="form__hint">상태나 화살표를 누르세요.</p>
          </section>
        )}
        <AnimatorPreview
          editor={editor}
          animator={animator}
          dir={dir}
          onDir={setDir}
          onState={setRuntimeState}
        />
      </aside>
      {dialog === 'guide' && <AnimatorGuide onClose={() => setDialog(null)} />}
      {dialog === 'skill' && (
        <SkillDialog
          animator={animator}
          choices={choices}
          usedKeys={usedKeys}
          onClose={() => setDialog(null)}
          onCreate={(next) => {
            commit(next);
            setDialog(null);
          }}
        />
      )}
    </section>
  );
}

function TransitionList({
  items,
  onSelect,
}: {
  items: { transition: AnimatorTransition; index: number }[];
  onSelect(index: number): void;
}) {
  if (items.length === 0) return <p className="form__hint">나가는 전이가 없습니다.</p>;
  return (
    <ol className="animator-editor__transitions">
      {items.map(({ transition, index }) => (
        <li key={index}>
          <button type="button" onClick={() => onSelect(index)}>
            → {transition.to}
            <small>{conditionText(transition) || '조건 없음'}</small>
          </button>
        </li>
      ))}
    </ol>
  );
}

function StateInspector({
  editor,
  dir,
  state,
  entry,
  choices,
  canRemove,
  transitions,
  onRename,
  onChange,
  onEntry,
  onLink,
  onRemove,
  onSelectTransition,
}: {
  editor: PixelDocument;
  dir: Dir;
  state: AnimatorState;
  entry: boolean;
  choices: string[];
  canRemove: boolean;
  transitions: { transition: AnimatorTransition; index: number }[];
  onRename(to: string): boolean;
  onChange(change: Partial<AnimatorState>, key?: string): void;
  onEntry(): void;
  onLink(): void;
  onRemove(): void;
  onSelectTransition(index: number): void;
}) {
  const [name, setName] = useState(state.name);
  const valid = ASSET_NAME_PATTERN.test(name);
  const commitName = () => {
    if (!onRename(name)) setName(state.name);
  };
  return (
    <section>
      <h3>상태</h3>
      <label className="pixel-editor__field">
        이름
        <input
          value={name}
          maxLength={32}
          aria-invalid={!valid || undefined}
          onChange={(e) => setName(e.target.value.toLowerCase())}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitName();
          }}
        />
      </label>
      <div className="pixel-editor__field">
        애니메이션
        <Select
          value={state.animation}
          aria-label="상태의 애니메이션"
          options={[
            ...(choices.includes(state.animation)
              ? []
              : [{ value: state.animation, label: `${state.animation} (없음)` }]),
            ...choices.map((c) => ({ value: c, label: c })),
          ]}
          onChange={(animation) => onChange({ animation })}
        />
      </div>
      <StateClip editor={editor} state={state} dir={dir} />
      <label className="pixel-editor__check">
        <input
          type="checkbox"
          checked={state.loop !== false}
          onChange={(e) => onChange({ loop: e.target.checked ? undefined : false })}
        />
        반복
      </label>
      <div className="pixel-editor__row">
        재생 속도
        <Select
          value={String(animatorStateSpeed(state))}
          aria-label="재생 속도"
          options={SPEEDS.map((v) => ({ value: String(v), label: `×${v}` }))}
          onChange={(v) => onChange({ speed: Number(v) === 1 ? undefined : Number(v) })}
        />
      </div>
      <label className="pixel-editor__check">
        <input
          type="checkbox"
          checked={!!state.lockMove}
          onChange={(e) => onChange({ lockMove: e.target.checked || undefined })}
        />
        이동 막기
      </label>
      <label className="pixel-editor__check">
        <input
          type="checkbox"
          checked={!!state.noInterrupt}
          onChange={(e) => onChange({ noInterrupt: e.target.checked || undefined })}
        />
        Any State로 끊기지 않기
      </label>
      <div className="animator-editor__row">
        <button type="button" className="button" disabled={entry} onClick={onEntry}>
          시작 상태로
        </button>
        <button type="button" className="button" onClick={onLink}>
          <Link2 aria-hidden /> 전이 만들기
        </button>
        <button
          type="button"
          className="button button--danger"
          disabled={!canRemove}
          onClick={onRemove}
        >
          <Trash2 aria-hidden /> 지우기
        </button>
      </div>
      <h4>나가는 전이 (위에서부터 봄)</h4>
      <TransitionList items={transitions} onSelect={onSelectTransition} />
    </section>
  );
}

function TransitionInspector({
  transition,
  params,
  onChange,
  onMove,
  onRemove,
}: {
  transition: AnimatorTransition;
  params: ReturnType<typeof animatorParameters>;
  onChange(change: Partial<AnimatorTransition>): void;
  onMove(step: -1 | 1): void;
  onRemove(): void;
}) {
  const names = [...params.keys()];
  const setCondition = (i: number, condition: AnimatorCondition) =>
    onChange({ conditions: transition.conditions.map((c, j) => (j === i ? condition : c)) });
  const withValue = (param: string, value?: boolean): AnimatorCondition =>
    params.get(param)?.type === AnimatorParamType.Bool
      ? { param, value: value ?? true }
      : { param };
  return (
    <section>
      <h3>
        전이: {transition.from === ANY_STATE ? 'Any State' : transition.from} → {transition.to}
      </h3>
      <h4>조건 (모두 맞아야 넘어감)</h4>
      {transition.conditions.length === 0 && <p className="form__hint">조건이 없습니다.</p>}
      <ul className="animator-editor__conditions">
        {transition.conditions.map((condition, i) => {
          const type = params.get(condition.param)?.type;
          return (
            <li key={i}>
              <Select
                value={condition.param}
                aria-label="파라미터"
                options={[
                  ...(params.has(condition.param)
                    ? []
                    : [{ value: condition.param, label: `${condition.param} (없음)` }]),
                  ...names.map((n) => ({ value: n, label: n })),
                ]}
                onChange={(param) => setCondition(i, withValue(param, condition.value))}
              />
              {type === AnimatorParamType.Bool ? (
                <Select
                  value={condition.value === false ? 'false' : 'true'}
                  aria-label="값"
                  options={[
                    { value: 'true', label: '참' },
                    { value: 'false', label: '거짓' },
                  ]}
                  onChange={(v) => setCondition(i, { param: condition.param, value: v === 'true' })}
                />
              ) : (
                <span className="form__hint">당기면</span>
              )}
              <button
                type="button"
                className="icon-button"
                aria-label="조건 지우기"
                onClick={() =>
                  onChange({ conditions: transition.conditions.filter((_, j) => j !== i) })
                }
              >
                <X aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        className="button"
        disabled={transition.conditions.length >= ANIMATOR_CONDITION_LIMIT}
        onClick={() =>
          onChange({ conditions: [...transition.conditions, withValue(names[0] ?? 'moving')] })
        }
      >
        <Plus aria-hidden /> 조건
      </button>
      <label className="pixel-editor__check">
        <input
          type="checkbox"
          checked={!!transition.exitTime}
          onChange={(e) =>
            onChange(
              e.target.checked ? { exitTime: true } : { exitTime: undefined, exitAt: undefined },
            )
          }
        />
        끝나면 넘어가기
      </label>
      {transition.exitTime && (
        <div className="pixel-editor__row">
          넘어가는 지점
          <Select
            value={String(Math.round((transition.exitAt ?? 1) * 100))}
            aria-label="애니메이션의 몇 % 지점에서 넘어갈지"
            options={EXIT_POINTS.map((v) => ({
              value: String(v),
              label: v === 100 ? '끝까지 (100%)' : `${v}%`,
            }))}
            onChange={(v) => onChange({ exitAt: Number(v) === 100 ? undefined : Number(v) / 100 })}
          />
        </div>
      )}
      <div className="animator-editor__row">
        <button type="button" className="button" onClick={() => onMove(-1)} title="먼저 보기">
          <ArrowUp aria-hidden /> 먼저
        </button>
        <button type="button" className="button" onClick={() => onMove(1)} title="나중에 보기">
          <ArrowDown aria-hidden /> 나중에
        </button>
        <button type="button" className="button button--danger" onClick={onRemove}>
          <Trash2 aria-hidden /> 지우기
        </button>
      </div>
    </section>
  );
}

function ParameterRow({
  parameter,
  usedKeys,
  taken,
  onChange,
  onRemove,
}: {
  parameter: AnimatorParameter;
  usedKeys: ReadonlySet<string>;
  taken(name: string): boolean;
  onChange(next: AnimatorParameter, key?: string): void;
  onRemove(): void;
}) {
  const [name, setName] = useState(parameter.name);
  const commitName = () => {
    if (name !== parameter.name && ASSET_NAME_PATTERN.test(name) && !taken(name)) {
      onChange({ ...parameter, name });
    } else setName(parameter.name);
  };
  return (
    <li>
      <div className="animator-editor__row">
        <span className="animator-editor__type" data-type={parameter.type}>
          {parameter.type === AnimatorParamType.Trigger ? '트리거' : '불 값'}
        </span>
        <input
          value={name}
          maxLength={32}
          aria-label="파라미터 이름"
          onChange={(e) => setName(e.target.value.toLowerCase())}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitName();
          }}
        />
        <button
          type="button"
          className="icon-button"
          aria-label="파라미터 지우기"
          onClick={onRemove}
        >
          <Trash2 aria-hidden />
        </button>
      </div>
      <div className="animator-editor__row">
        <KeyCapture
          value={parameter.key}
          aria-label="광장에서 누를 키"
          taken={(key) => key !== parameter.key && usedKeys.has(key)}
          onChange={(key) => {
            const next = { ...parameter };
            if (key) next.key = key;
            else delete next.key;
            onChange(next);
          }}
        />
        <input
          value={parameter.label ?? ''}
          maxLength={MOTION_LABEL_MAX_LENGTH}
          placeholder="모션 목록 이름"
          aria-label="모션 목록에 보일 이름"
          onChange={(e) => {
            const next = { ...parameter };
            if (e.target.value.trim()) next.label = e.target.value;
            else delete next.label;
            onChange(next, `param-label:${parameter.name}`);
          }}
        />
      </div>
      {parameter.type === AnimatorParamType.Bool && (
        <label className="pixel-editor__check">
          <input
            type="checkbox"
            checked={!!parameter.hold}
            onChange={(e) => {
              const next = { ...parameter };
              if (e.target.checked) next.hold = true;
              else delete next.hold;
              onChange(next);
            }}
          />
          누르는 동안만 켜기
        </label>
      )}
    </li>
  );
}

const PREVIEW_BOX = 128;
/** 당긴 트리거 버튼이 켜진 모습으로 보이는 시간 */
const FIRED_FLASH_MS = 250;

/**
 * 미리보기에서 고르는 광장의 상황. 광장에서는 공중이면 위치가 바뀌므로 걷는 중(moving)도 켜져 있고, 떨어지는
 * 중이면 공중이다. 예전엔 셋을 따로 켜고 꺼서 광장에서 나올 수 없는 조합(서 있는데 떨어지는 중 등)을 만들었고,
 * 떨어지는 중은 공중을 먼저 켜야 눌렸다.
 */
const SITUATIONS = {
  stand: {
    label: '서 있음',
    hint: '모두 꺼짐',
    values: { moving: false, airborne: false, falling: false },
  },
  walk: {
    label: '걷는 중',
    hint: 'moving',
    values: { moving: true, airborne: false, falling: false },
  },
  rise: {
    label: '뛰어오르는 중',
    hint: 'moving + airborne',
    values: { moving: true, airborne: true, falling: false },
  },
  fall: {
    label: '떨어지는 중',
    hint: 'moving + airborne + falling',
    values: { moving: true, airborne: true, falling: true },
  },
} as const;
type Situation = keyof typeof SITUATIONS;

/**
 * 애니메이터 미리보기: 광장처럼 그래프를 돌린다. 걷는 중·공중을 켜고 끄고, 트리거를 당겨 볼 수 있다.
 * 에디터 문서의 프레임을 바로 그리므로 저장하지 않아도 그린 그림이 보인다.
 */
function AnimatorPreview({
  editor,
  animator,
  dir,
  onDir,
  onState,
}: {
  editor: PixelDocument;
  animator: Animator;
  dir: Dir;
  onDir(dir: Dir): void;
  onState(state: string | null): void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  /** 그래프를 돌리는 상태. 첫 프레임에 만든다 (처음부터 누르면 비운다) */
  const runtime = useRef<AnimatorRuntime | null>(null);
  /** 광장의 상황 (걷는 중·공중·떨어지는 중을 광장과 같은 조합으로 정한다) */
  const [situation, setSituation] = useState<Situation>('stand');
  /** 방금 당긴 트리거 (버튼을 잠깐 켜진 모습으로) */
  const [fired, setFired] = useState<string | null>(null);
  const firedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(firedTimer.current), []);
  /** 지금 상태가 이동을 막는지 (보여 주기만 한다) */
  const [locked, setLocked] = useState(false);
  /** 직접 만든 불 값 파라미터 (이름 → 값). 매 프레임 그래프에 넣고, 처음부터면 함께 끈다 */
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [shown, setShown] = useState(animator.entry);
  // 그리는 루프는 한 번만 걸고, 바뀐 값은 이 ref로 읽는다.
  const live = useRef({ animator, dir, situation, flags });
  useEffect(() => {
    live.current = { animator, dir, situation, flags };
  });
  /** 땅 ↔ 공중이 바뀌면 광장처럼 jump·land 트리거를 당긴다 (그리는 루프가 본다) */
  const landed = useRef(true);
  const { width, height } = editor.doc;
  const longest = Math.max(width, height);
  const scale = Math.max(1, Math.floor(PREVIEW_BOX / longest));
  const shownSize = PREVIEW_BOX / longest;

  useEffect(() => {
    let raf = 0;
    let drawn = '';
    let shownState = '';
    const tick = (now: number) => {
      const { animator: graph, dir: facing, situation: place, flags: on } = live.current;
      const { moving: walk, airborne: air, falling: fall } = SITUATIONS[place].values;
      runtime.current ??= startAnimator(graph, now);
      const doc = editor.doc;
      // 문서의 애니메이션을 매니페스트 꼴로 (프레임 번호는 애니메이션 안의 순서)
      const owner = new Map<AssetAnimation, EditorAnimation>();
      const animations: Record<string, AssetAnimation> = {};
      for (const a of doc.animations) {
        const clip = { frames: a.frames.map((_, i) => i), frameMs: a.frameMs };
        animations[a.name] = clip;
        owner.set(clip, a);
      }
      const shape = { animations, style: doc.style };
      const rt = runtime.current;
      setAnimatorBool(rt, 'moving', walk);
      setAnimatorBool(rt, 'airborne', air);
      setAnimatorBool(rt, 'falling', fall);
      if (landed.current === air) {
        fireTrigger(rt, air ? 'jump' : 'land', now);
        landed.current = !air;
      }
      for (const p of graph.parameters) {
        if (p.type === AnimatorParamType.Bool) setAnimatorBool(rt, p.name, on[p.name] ?? false);
      }
      stepAnimator(graph, rt, now, (state) => {
        const clip = animatorClip(shape, state.animation, facing);
        return clip ? clip.animation.frames.length * clip.animation.frameMs : 0;
      });
      if (rt.state !== shownState) {
        shownState = rt.state;
        setShown(rt.state);
        setLocked(animatorLocksMovement(graph, rt));
        onState(rt.state);
      }
      const state = graph.states.find((s) => s.name === rt.state);
      const clip = state ? animatorClip(shape, state.animation, facing) : undefined;
      const source = clip ? owner.get(clip.animation) : undefined;
      const canvas = ref.current;
      if (canvas && source && source.frames.length > 0) {
        // rAF의 now는 트리거를 당긴 시각(performance.now())보다 이를 수 있다 (음수면 프레임 번호가 -1)
        const elapsed = Math.max(0, now - rt.since) * animatorStateSpeed(state!);
        const step = Math.floor(elapsed / source.frameMs);
        const index =
          state?.loop === false
            ? Math.min(step, source.frames.length - 1)
            : step % source.frames.length;
        const flip = clip!.directional
          ? clip!.mirrored
          : doc.style === PlazaStyle.SideScroll && facing === 'left';
        const key = `${source.name}:${index}:${flip}:${editor.version}`;
        if (key !== drawn) {
          drawn = key;
          const ctx = canvas.getContext('2d')!;
          ctx.imageSmoothingEnabled = false;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.save();
          if (flip) {
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
          }
          ctx.drawImage(
            frameCanvas(source.frames[index]!, doc.width, doc.height, doc.palette),
            0,
            0,
            canvas.width,
            canvas.height,
          );
          ctx.restore();
        }
      } else if (canvas && drawn !== 'empty') {
        drawn = 'empty';
        canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      onState(null);
    };
  }, [editor, onState]);

  const triggers = [
    ...BUILTIN_ANIMATOR_PARAMETERS.filter((p) => p.type === AnimatorParamType.Trigger),
    ...animator.parameters.filter((p) => p.type === AnimatorParamType.Trigger),
  ];
  const bools = animator.parameters.filter((p) => p.type === AnimatorParamType.Bool);

  return (
    <section className="animator-editor__preview">
      <h3>미리보기</h3>
      <div className="animator-editor__stage">
        <canvas
          ref={ref}
          width={width * scale}
          height={height * scale}
          style={{ width: width * shownSize, height: height * shownSize }}
        />
      </div>
      <p className="animator-editor__current">
        지금 상태: <strong>{shown}</strong>
        {locked && <span className="animator-editor__locked">이동 막힘</span>}
      </p>
      <div className="animator-editor__row">
        <Select
          value={dir}
          aria-label="보는 방향"
          options={DIRECTIONS.map((d) => ({ value: d.id, label: d.label }))}
          onChange={(v) => onDir(v as Dir)}
        />
        <button
          type="button"
          className="icon-button"
          title="처음부터"
          aria-label="처음부터"
          onClick={() => {
            runtime.current = null;
            // 그래프와 함께 불 값도 처음으로 (예전엔 체크 표시는 남고 값만 꺼져 서로 달랐다)
            setFlags({});
            landed.current = true;
          }}
        >
          <RotateCcw aria-hidden />
        </button>
      </div>
      <div className="animator-editor__situations" role="radiogroup" aria-label="광장의 상황">
        {(Object.keys(SITUATIONS) as Situation[]).map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={situation === id}
            title={SITUATIONS[id].hint}
            onClick={() => setSituation(id)}
          >
            {SITUATIONS[id].label}
          </button>
        ))}
      </div>
      <p className="animator-editor__values">
        {(['moving', 'airborne', 'falling'] as const).map((name) => (
          <code key={name} data-on={SITUATIONS[situation].values[name] || undefined}>
            {name}
          </code>
        ))}
      </p>
      <div className="animator-editor__triggers">
        {/* 불 값도 트리거처럼 버튼: 누르는 동안 켜기는 누르고 있는 동안만, 아니면 누를 때마다 켜고 끈다 */}
        {bools.map((p) => (
          <button
            key={p.name}
            type="button"
            className="button animator-editor__flag"
            aria-pressed={flags[p.name] ?? false}
            title={p.hold ? '누르는 동안 켜짐' : '누를 때마다 켜고 끔'}
            {...(p.hold
              ? {
                  onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    setFlags((f) => ({ ...f, [p.name]: true }));
                  },
                  onPointerUp: () => setFlags((f) => ({ ...f, [p.name]: false })),
                  onPointerCancel: () => setFlags((f) => ({ ...f, [p.name]: false })),
                }
              : { onClick: () => setFlags((f) => ({ ...f, [p.name]: !f[p.name] })) })}
          >
            {p.name}
          </button>
        ))}
        {triggers.map((p) => (
          <button
            key={p.name}
            type="button"
            className="button animator-editor__flag"
            // 당긴 트리거도 불 값처럼 잠깐 켜진 모습을 보여 준다
            aria-pressed={fired === p.name}
            onClick={() => {
              if (runtime.current) fireTrigger(runtime.current, p.name, performance.now());
              setFired(p.name);
              clearTimeout(firedTimer.current);
              firedTimer.current = setTimeout(() => setFired(null), FIRED_FLASH_MS);
            }}
          >
            {p.name}
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * 고른 상태의 애니메이션만 되풀이해 보여 준다 (GIF로 만든 상태가 어떤 그림인지 바로 보이게). 보는 방향은
 * 미리보기와 같고, 상태의 재생 속도·반복 여부를 그대로 따른다.
 */
function StateClip({
  editor,
  state,
  dir,
}: {
  editor: PixelDocument;
  state: AnimatorState;
  dir: Dir;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { doc } = editor;
  const animations: Record<string, AssetAnimation> = {};
  const owner = new Map<AssetAnimation, EditorAnimation>();
  for (const a of doc.animations) {
    const clip = { frames: a.frames.map((_, i) => i), frameMs: a.frameMs };
    animations[a.name] = clip;
    owner.set(clip, a);
  }
  const clip = animatorClip({ animations, style: doc.style }, state.animation, dir);
  const source = clip ? owner.get(clip.animation) : undefined;
  const flip = clip
    ? clip.directional
      ? clip.mirrored
      : doc.style === PlazaStyle.SideScroll && dir === 'left'
    : false;
  const longest = Math.max(doc.width, doc.height);
  const scale = Math.max(1, Math.floor(CLIP_BOX / longest));
  const shownSize = CLIP_BOX / longest;
  const speed = animatorStateSpeed(state);
  const once = state.loop === false;
  const sourceName = source?.name;

  // 그리는 루프: 상태·방향·그림이 바뀔 때마다 새로 건다 (한 번 트는 상태는 끝에서 잠깐 머문 뒤 처음부터)
  useEffect(() => {
    let raf = 0;
    let drawn = '';
    const start = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const canvas = ref.current;
      const current = editor.doc.animations.find((a) => a.name === sourceName);
      if (!canvas || !current || current.frames.length === 0) return;
      const length = current.frames.length;
      const step = Math.floor((Math.max(0, now - start) * speed) / current.frameMs);
      const index = once ? Math.min(step % (length + 4), length - 1) : step % length;
      const key = `${index}:${editor.version}`;
      if (key === drawn) return;
      drawn = key;
      const { width, height, palette } = editor.doc;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      if (flip) {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(
        frameCanvas(current.frames[index]!, width, height, palette),
        0,
        0,
        canvas.width,
        canvas.height,
      );
      ctx.restore();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [editor, sourceName, flip, speed, once]);

  if (!source) {
    return <p className="form__error">이 상태의 애니메이션({state.animation})이 없습니다.</p>;
  }
  const cycle = Math.round((source.frames.length * source.frameMs) / speed);
  return (
    <figure className="animator-editor__clip">
      <div className="animator-editor__stage">
        <canvas
          ref={ref}
          width={doc.width * scale}
          height={doc.height * scale}
          style={{ width: doc.width * shownSize, height: doc.height * shownSize }}
        />
      </div>
      <figcaption>
        {source.name} · {source.frames.length}프레임 · 한 바퀴 {(cycle / 1000).toFixed(2)}초
      </figcaption>
    </figure>
  );
}

/** 고른 상태의 애니메이션 미리보기 크기 (가장 긴 변, px) */
const CLIP_BOX = 96;

/**
 * 애니메이터 안에 뜨는 창 (도움말, 스킬 만들기). Esc는 이 창만 닫는다: 도트 에디터의 키 처리는 에디터
 * 안에 이 창이 떠 있으면 아무것도 하지 않고, 여기서 막아(preventDefault) 아래의 설정 창도 닫히지 않는다.
 */
function EditorDialog({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || isKeyboardClaimed()) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input, button:not(.dialog__close)')?.focus();
  }, []);
  return (
    <div
      className="dialog__overlay animator-dialog"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        className={wide ? 'dialog dialog--wide' : 'dialog'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="dialog__header">
          <h2>{title}</h2>
          <button
            type="button"
            className="icon-button dialog__close"
            onClick={onClose}
            aria-label="닫기"
            title="닫기 (Esc)"
          >
            <X aria-hidden />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

/** 유니티 Animator를 써 보지 않은 사람을 위한 설명 */
function AnimatorGuide({ onClose }: { onClose(): void }) {
  return (
    <EditorDialog title="애니메이터 도움말" onClose={onClose} wide>
      <div className="animator-guide">
        <p>
          애니메이터는 광장에서 <strong>언제 어떤 애니메이션을 틀지</strong> 정하는 그림입니다.
          상자(상태)를 화살표(전이)로 이어 &ldquo;이런 일이 생기면 저 애니메이션으로
          넘어가라&rdquo;를 적습니다. 유니티의 Animator와 같은 방식입니다.
        </p>
        <h3>상태 (상자)</h3>
        <ul>
          <li>상자 하나가 애니메이션 하나를 틉니다. 주황 테두리가 처음 시작하는 상태입니다.</li>
          <li>
            <code>walk</code>처럼 방향 없이 고르면 광장에서 보는 방향의 <code>walk-left</code> 등을
            찾아 씁니다.
          </li>
          <li>
            반복을 끄면 한 번 틀고 마지막 프레임에 머뭅니다. 재생 속도로 빠르게·느리게 틀고, 이동
            막기를 켜면 그 상태 동안 캐릭터가 제자리에 섭니다 (기술을 쓰는 동안).
          </li>
          <li>상태를 누르면 오른쪽에 그 상태의 애니메이션이 움직이며 보입니다.</li>
        </ul>
        <h3>전이 (화살표)</h3>
        <ul>
          <li>조건을 모두 만족하면 화살표 방향으로 넘어갑니다.</li>
          <li>
            &ldquo;끝나면 넘어가기&rdquo;를 켜면 지금 애니메이션이 한 바퀴 돈 뒤에 넘어갑니다.
            넘어가는 지점을 60%처럼 앞당기면 동작이 끝나기 전에 다음 동작으로 이어집니다 (콤보).
          </li>
          <li>
            한 상태에서 나가는 화살표가 여럿이면 위에서부터 보고 처음 맞는 것으로 갑니다 (설정 칸의
            먼저/나중에로 순서를 바꿈).
          </li>
        </ul>
        <h3>경고</h3>
        <p>
          저장은 되지만 의도대로 돌지 않을 그래프는 왼쪽 파라미터 칸 아래 노란 칸에 알려 줍니다.
          예를 들어 Any State → jump(airborne)와 Any State → fall(falling)을 함께 두면 떨어지는 동안
          두 조건이 다 맞아 jump와 fall을 매 프레임 오가며 첫 프레임에 멈춘 것처럼 보입니다. 이때는
          Any State → jump에 <code>falling</code> 거짓 조건을 더하거나, fall을 &ldquo;Any State
          전이로 끊기지 않기&rdquo;로 둡니다.
        </p>
        <h3>Any State</h3>
        <p>
          여기서 나가는 화살표는 <strong>어느 상태에서든</strong> 조건이 맞으면 넘어갑니다 (첨부를
          보내면 어디서든 emote 등). 다른 화살표보다 먼저 봅니다. 콤보처럼 중간에 끊기면 안 되는
          상태는 &ldquo;Any State 전이로 끊기지 않기&rdquo;를 켭니다.
        </p>
        <h3>파라미터 (조건에 쓰는 값)</h3>
        <ul>
          <li>
            광장이 정하는 것: <code>moving</code>(걷는 중), <code>airborne</code>(공중),{' '}
            <code>falling</code>(떨어지는 중), <code>jump</code>·<code>land</code>(뛰어오름·착지
            순간), <code>emote</code>(첨부를 보낸 순간)
          </li>
          <li>
            <strong>트리거</strong>: 키를 누르면 한 번 당겨지고, 그것을 조건으로 한 전이가 쓰면
            사라집니다 (기술, 공격).
          </li>
          <li>
            <strong>불 값</strong>: 켜짐/꺼짐. 키를 누를 때마다 바꾸거나, &ldquo;누르는 동안만
            켜기&rdquo;로 누르고 있는 동안만 켭니다 (모아 쏘기, 막기).
          </li>
          <li>
            키는 파라미터의 키 칸을 누른 뒤 원하는 키를 직접 눌러 답니다 (Backspace로 지우기).
            광장이 쓰는 방향키·스페이스·/·Enter와 Ctrl·Alt 조합은 달 수 없습니다. 광장의 다른 사람
            화면에도 똑같이 보입니다.
          </li>
        </ul>
        <h3>이렇게 만들어 보세요</h3>
        <ul>
          <li>
            <strong>기술 하나</strong>: 트리거 <code>slash</code>(Z 키) → Any State에서{' '}
            <code>slash</code> 상태로 (조건 slash), <code>slash</code>에서 시작 상태로 (끝나면).
          </li>
          <li>
            <strong>3단 콤보</strong>: 1타 → 2타 → 3타를 같은 트리거 + &ldquo;끝나면&rdquo;(60%)으로
            잇고, 각 타에서 시작 상태로 (끝나면)도 잇습니다. 치는 중에 다시 누르면 다음 타로
            이어집니다.
          </li>
          <li>
            <strong>모아 쏘기</strong>: 누르는 동안만 켜지는 불 값 <code>charge</code> → 켜지면
            모으기 상태, 꺼지면 쏘기 상태, 쏘기가 끝나면 시작 상태로.
          </li>
          <li>
            <strong>공중 공격</strong>: 조건을 <code>airborne</code>(참) + 트리거로 두 개 달면 뛰어
            있을 때만 씁니다.
          </li>
        </ul>
        <p className="form__hint">
          기술 하나·콤보·모아 쏘기는 도구 막대의 &ldquo;스킬 만들기&rdquo;로 한 번에 만들 수
          있습니다. 오른쪽 미리보기에서 걷는 중·공중을 켜고 트리거를 눌러 바로 시험해 보세요.
        </p>
      </div>
    </EditorDialog>
  );
}

const SKILL_KINDS: { id: SkillKind; label: string; hint: string }[] = [
  { id: 'once', label: '기술 하나', hint: '키를 누르면 한 번 쓰고 돌아옵니다.' },
  {
    id: 'combo',
    label: '콤보',
    hint: '치는 중에 다시 누르면 다음 타로 이어집니다.',
  },
  {
    id: 'hold',
    label: '모아 쏘기',
    hint: '누르는 동안 모으고, 떼면 쏩니다.',
  },
];

/** 스킬 만들기: 종류·키·애니메이션을 고르면 파라미터·상태·전이를 한 번에 만든다 */
function SkillDialog({
  animator,
  choices,
  usedKeys,
  onClose,
  onCreate,
}: {
  animator: Animator;
  choices: string[];
  usedKeys: ReadonlySet<string>;
  onClose(): void;
  onCreate(next: Animator): void;
}) {
  const freeKeys = SUGGESTED_KEYS.filter((k) => !usedKeys.has(k));
  const [kind, setKind] = useState<SkillKind>('once');
  const [name, setName] = useState('skill');
  const [label, setLabel] = useState('');
  const [key, setKey] = useState<string>(
    freeKeys.find((k) => /[a-z]/.test(k)) ?? freeKeys[0] ?? '',
  );
  const [animations, setAnimations] = useState<string[]>([choices[0] ?? '', '', '']);
  const [lockMove, setLockMove] = useState(true);
  const [comboAt, setComboAt] = useState(60);
  const [error, setError] = useState<string | null>(null);
  const slots =
    kind === 'once'
      ? [{ label: '기술 애니메이션', optional: false }]
      : kind === 'combo'
        ? [
            { label: '1타', optional: false },
            { label: '2타', optional: false },
            { label: '3타', optional: true },
          ]
        : [
            { label: '모으기', optional: false },
            { label: '쏘기', optional: true },
          ];
  const create = () => {
    if (!ASSET_NAME_PATTERN.test(name)) {
      setError('이름은 영문 소문자로 시작하고 소문자·숫자·-만 씁니다.');
      return;
    }
    const result = addSkill(animator, {
      kind,
      name,
      key: key || undefined,
      label,
      animations: animations.slice(0, slots.length).filter(Boolean),
      lockMove,
      comboAt: comboAt / 100,
    });
    if (typeof result === 'string') setError(result);
    else onCreate(result);
  };
  return (
    <EditorDialog title="스킬 만들기" onClose={onClose}>
      <div className="animator-skill">
        <div className="pixel-editor__segmented" role="radiogroup" aria-label="스킬 종류">
          {SKILL_KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              role="radio"
              aria-checked={kind === k.id}
              onClick={() => {
                setKind(k.id);
                setError(null);
              }}
            >
              {k.label}
            </button>
          ))}
        </div>
        <p className="form__hint">{SKILL_KINDS.find((k) => k.id === kind)!.hint}</p>
        <label className="pixel-editor__field">
          이름 (영문)
          <input
            value={name}
            maxLength={24}
            aria-invalid={!ASSET_NAME_PATTERN.test(name) || undefined}
            onChange={(e) => setName(e.target.value.toLowerCase())}
          />
        </label>
        <div className="pixel-editor__row">
          키
          <KeyCapture
            value={key || undefined}
            aria-label="광장에서 누를 키"
            taken={(k) => usedKeys.has(k)}
            onChange={(k) => setKey(k ?? '')}
          />
          <input
            value={label}
            maxLength={MOTION_LABEL_MAX_LENGTH}
            placeholder="모션 목록 이름 (예: 베기)"
            aria-label="모션 목록에 보일 이름"
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        {slots.map((slot, i) => (
          <div key={`${kind}-${i}`} className="pixel-editor__row">
            {slot.label}
            {slot.optional ? ' (선택)' : ''}
            <Select
              value={animations[i] ?? ''}
              aria-label={slot.label}
              options={[
                { value: '', label: slot.optional ? '없음' : '고르세요' },
                ...choices.map((c) => ({ value: c, label: c })),
              ]}
              onChange={(v) => setAnimations((list) => list.map((a, j) => (j === i ? v : a)))}
            />
          </div>
        ))}
        {kind === 'combo' && (
          <div className="pixel-editor__row">
            다음 타로 넘어가는 지점
            <Select
              value={String(comboAt)}
              aria-label="다음 타로 넘어가는 지점"
              options={EXIT_POINTS.map((v) => ({
                value: String(v),
                label: v === 100 ? '끝까지 (100%)' : `${v}%`,
              }))}
              onChange={(v) => setComboAt(Number(v))}
            />
          </div>
        )}
        <label className="pixel-editor__check">
          <input
            type="checkbox"
            checked={lockMove}
            onChange={(e) => setLockMove(e.target.checked)}
          />
          이동 막기
        </label>
        {error && (
          <p className="form__error" role="alert">
            {error}
          </p>
        )}
        <div className="animator-skill__actions">
          <button type="button" className="button" onClick={onClose}>
            취소
          </button>
          <button type="button" className="button button--primary" onClick={create}>
            만들기
          </button>
        </div>
      </div>
    </EditorDialog>
  );
}
