import {
  ANIMATOR_CONDITION_LIMIT,
  ANIMATOR_PARAMETER_LIMIT,
  ANIMATOR_STATE_LIMIT,
  ANIMATOR_TRANSITION_LIMIT,
  ANY_STATE,
  ASSET_NAME_PATTERN,
  type Animator,
  type AnimatorCondition,
  AnimatorParamType,
  type AnimatorRuntime,
  type AnimatorState,
  type AnimatorTransition,
  type AssetAnimation,
  BUILTIN_ANIMATOR_PARAMETERS,
  MOTION_KEYS,
  MOTION_LABEL_MAX_LENGTH,
  type MotionKey,
  PlazaStyle,
  animatorAnimationChoices,
  animatorAnimationExists,
  animatorClip,
  animatorParameters,
  animatorProblems,
  defaultAnimator,
  fireTrigger,
  setAnimatorBool,
  startAnimator,
  stepAnimator,
} from '@metacode/shared';
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { EditorAnimation, PixelDocument } from './editorModel';
import { frameCanvas } from './pixelCanvas';
import { ArrowDown, ArrowUp, ImagePlus, Link2, Plus, RotateCcw, Trash2, X } from 'lucide-react';

/** 그래프 위 상태 상자 크기 */
const NODE_W = 150;
const NODE_H = 48;
/** 끌어 옮길 때 맞추는 칸 */
const GRID = 8;
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

const snap = (v: number) => Math.round(v / GRID) * GRID;

/** 비어 있는 이름 (base, base-2, base-3 …) */
function freeName(base: string, used: ReadonlySet<string>): string {
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
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
  if (transition.exitTime) parts.push('끝나면');
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

  if (!animator) {
    return (
      <section className="animator-editor animator-editor--empty" aria-label="애니메이터">
        <div className="animator-editor__intro">
          <h2>애니메이터</h2>
          <p>
            상태(애니메이션)와 전이(화살표)로 광장에서 어떤 애니메이션을 언제 틀지 정합니다. 걷는
            중·공중· 착지·첨부 보냄 같은 광장의 상황과, 숫자 키로 당기는 직접 만든 트리거로 상태를
            옮길 수 있습니다. 애니메이터가 없으면 대기·걷기·점프·첨부 모션을 정해진 규칙대로 틉니다.
          </p>
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
            <button type="button" className="button" onClick={onClose}>
              닫기
            </button>
          </div>
        </div>
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
  /** Any State 상자 자리 (저장하지 않는다) */
  const [anyAt, setAnyAt] = useState(() => ({
    x: Math.min(...animator.states.map((s) => s.x)) - 220,
    y: Math.min(...animator.states.map((s) => s.y)),
  }));
  const drag = useRef<
    | {
        kind: 'state';
        name: string;
        start: { x: number; y: number };
        from: { x: number; y: number };
      }
    | { kind: 'any'; start: { x: number; y: number }; from: { x: number; y: number } }
    | { kind: 'pan'; start: { x: number; y: number }; from: { x: number; y: number } }
    | null
  >(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [runtimeState, setRuntimeState] = useState<string | null>(null);

  const commit = (next: Animator, key?: string) => editor.setAnimator(next, key);
  const problems = animatorProblems(animator, names);
  const params = animatorParameters(animator);
  const byName = new Map(animator.states.map((s) => [s.name, s]));
  const choices = animatorAnimationChoices(names);
  const usedKeys = new Set<string>([
    ...editor.doc.animations.map((a) => a.key).filter((k): k is MotionKey => !!k),
    ...animator.parameters.map((p) => p.key).filter((k): k is MotionKey => !!k),
  ]);

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
        ? { kind: 'any', start: { x: e.clientX, y: e.clientY }, from: { ...at } }
        : {
            kind: 'state',
            name,
            start: { x: e.clientX, y: e.clientY },
            from: { x: at.x, y: at.y },
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
      setAnyAt({ x: snap(current.from.x + dx), y: snap(current.from.y + dy) });
    } else {
      const x = snap(current.from.x + dx);
      const y = snap(current.from.y + dy);
      const state = byName.get(current.name);
      if (state && (state.x !== x || state.y !== y)) {
        updateState(current.name, { x, y }, `move:${current.name}`);
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
          title="GIF를 새 애니메이션으로 넣고 그것을 트는 상태를 만듭니다 (모션을 따로 만들지 않아도 됨)"
          onClick={onAddFromGif}
        >
          <ImagePlus aria-hidden /> GIF로 상태
        </button>
        <button
          type="button"
          className="button"
          aria-pressed={linking !== null}
          disabled={!selection || selection.kind === 'transition'}
          title="고른 상태에서 다른 상태로 가는 화살표를 만듭니다 (다음에 누르는 상태로)"
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
        {linking !== null && (
          <span className="form__hint">이어 줄 상태를 누르세요 (빈 곳을 누르면 취소)</span>
        )}
        <span className="animator-editor__spacer" />
        <button
          type="button"
          className="button button--danger"
          onClick={() => {
            if (
              window.confirm('애니메이터를 없앨까요? 정해진 규칙대로 틀게 됩니다 (되돌리기 가능).')
            ) {
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
        {animator.parameters.length === 0 && (
          <p className="form__hint">
            숫자 키를 달면 광장에서 그 키로 트리거를 당기거나 켜고 끕니다.
          </p>
        )}
        <ul className="animator-editor__custom">
          {animator.parameters.map((p, i) => (
            <ParameterRow
              key={i}
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
                  {state.animation}
                  {state.loop === false ? ' · 한 번' : ''}
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
        <p className="animator-editor__hint">
          빈 곳을 끌어 그래프를 옮기고, 상태를 끌어 자리를 바꿉니다. 같은 상태 안에서는 Any State
          전이를 먼저, 그다음 그 상태의 전이를 위에서부터 봅니다.
        </p>
      </div>

      <aside className="animator-editor__inspector" aria-label="설정">
        {selectedState ? (
          <StateInspector
            key={selectedState.name}
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
            <p className="form__hint">
              여기서 나가는 전이는 어느 상태에서든 조건이 맞으면 넘어갑니다 (첨부 보냄 → emote 등).
              지금 상태로 다시 들어가는 전이는 트리거가 있을 때만 씁니다.
            </p>
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
            <p className="form__hint">
              상태를 누르면 애니메이션과 전이를, 화살표를 누르면 조건을 고칩니다. 주황 테두리가 처음
              시작하는 상태입니다.
            </p>
          </section>
        )}
        <AnimatorPreview editor={editor} animator={animator} onState={setRuntimeState} />
      </aside>
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
      <label className="pixel-editor__field">
        애니메이션
        <select value={state.animation} onChange={(e) => onChange({ animation: e.target.value })}>
          {!choices.includes(state.animation) && (
            <option value={state.animation}>{state.animation} (없음)</option>
          )}
          {choices.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <p className="form__hint">
        방향이 붙은 애니메이션(walk-left 등)은 방향을 뗀 이름으로 고르면 광장이 보는 방향의 것을
        씁니다.
      </p>
      <label className="pixel-editor__check">
        <input
          type="checkbox"
          checked={state.loop !== false}
          onChange={(e) => onChange({ loop: e.target.checked ? undefined : false })}
        />
        반복 (끄면 한 번 틀고 마지막 프레임에 머묾)
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
              <select
                value={condition.param}
                aria-label="파라미터"
                onChange={(e) => setCondition(i, withValue(e.target.value, condition.value))}
              >
                {!params.has(condition.param) && (
                  <option value={condition.param}>{condition.param} (없음)</option>
                )}
                {names.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              {type === AnimatorParamType.Bool ? (
                <select
                  value={condition.value === false ? 'false' : 'true'}
                  aria-label="값"
                  onChange={(e) =>
                    setCondition(i, { param: condition.param, value: e.target.value === 'true' })
                  }
                >
                  <option value="true">참</option>
                  <option value="false">거짓</option>
                </select>
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
          onChange={(e) => onChange({ exitTime: e.target.checked || undefined })}
        />
        끝나면 넘어가기 (지금 애니메이션을 한 번 다 튼 뒤에)
      </label>
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
  parameter: Animator['parameters'][number];
  usedKeys: ReadonlySet<string>;
  taken(name: string): boolean;
  onChange(next: Animator['parameters'][number], key?: string): void;
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
        <select
          value={parameter.key ?? ''}
          aria-label="광장에서 누를 숫자 키"
          onChange={(e) => {
            const key = (e.target.value || undefined) as MotionKey | undefined;
            const next = { ...parameter };
            if (key) next.key = key;
            else delete next.key;
            onChange(next);
          }}
        >
          <option value="">키 없음</option>
          {MOTION_KEYS.filter((k) => k === parameter.key || !usedKeys.has(k)).map((k) => (
            <option key={k} value={k}>
              {k} 키
            </option>
          ))}
        </select>
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
    </li>
  );
}

const PREVIEW_BOX = 128;

/**
 * 애니메이터 미리보기: 광장처럼 그래프를 돌린다. 걷는 중·공중을 켜고 끄고, 트리거를 당겨 볼 수 있다.
 * 에디터 문서의 프레임을 바로 그리므로 저장하지 않아도 그린 그림이 보인다.
 */
function AnimatorPreview({
  editor,
  animator,
  onState,
}: {
  editor: PixelDocument;
  animator: Animator;
  onState(state: string | null): void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  /** 그래프를 돌리는 상태. 첫 프레임에 만든다 (처음부터 누르면 비운다) */
  const runtime = useRef<AnimatorRuntime | null>(null);
  const [dir, setDir] = useState<Dir>(
    editor.doc.style === PlazaStyle.SideScroll ? 'right' : 'down',
  );
  const [moving, setMoving] = useState(false);
  const [airborne, setAirborne] = useState(false);
  const [shown, setShown] = useState(animator.entry);
  // 그리는 루프는 한 번만 걸고, 바뀐 값은 이 ref로 읽는다.
  const live = useRef({ animator, dir, moving, airborne });
  useEffect(() => {
    live.current = { animator, dir, moving, airborne };
  });
  const { width, height } = editor.doc;
  const longest = Math.max(width, height);
  const scale = Math.max(1, Math.floor(PREVIEW_BOX / longest));
  const shownSize = PREVIEW_BOX / longest;

  useEffect(() => {
    let raf = 0;
    let drawn = '';
    let shownState = '';
    const tick = (now: number) => {
      const { animator: graph, dir: facing, moving: walk, airborne: air } = live.current;
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
      stepAnimator(graph, rt, now, (state) => {
        const clip = animatorClip(shape, state.animation, facing);
        return clip ? clip.animation.frames.length * clip.animation.frameMs : 0;
      });
      if (rt.state !== shownState) {
        shownState = rt.state;
        setShown(rt.state);
        onState(rt.state);
      }
      const state = graph.states.find((s) => s.name === rt.state);
      const clip = state ? animatorClip(shape, state.animation, facing) : undefined;
      const source = clip ? owner.get(clip.animation) : undefined;
      const canvas = ref.current;
      if (canvas && source && source.frames.length > 0) {
        // rAF의 now는 트리거를 당긴 시각(performance.now())보다 이를 수 있다 (음수면 프레임 번호가 -1)
        const elapsed = Math.max(0, now - rt.since);
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
      </p>
      <div className="animator-editor__row">
        <select value={dir} onChange={(e) => setDir(e.target.value as Dir)} aria-label="보는 방향">
          {DIRECTIONS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="icon-button"
          title="처음부터"
          aria-label="처음부터"
          onClick={() => {
            runtime.current = null;
          }}
        >
          <RotateCcw aria-hidden />
        </button>
      </div>
      <label className="pixel-editor__check">
        <input type="checkbox" checked={moving} onChange={(e) => setMoving(e.target.checked)} />
        moving (걷는 중)
      </label>
      <label className="pixel-editor__check">
        <input type="checkbox" checked={airborne} onChange={(e) => setAirborne(e.target.checked)} />
        airborne (공중)
      </label>
      {bools.map((p) => (
        <label key={p.name} className="pixel-editor__check">
          <input
            type="checkbox"
            defaultChecked={false}
            onChange={(e) => {
              if (runtime.current) setAnimatorBool(runtime.current, p.name, e.target.checked);
            }}
          />
          {p.name}
        </label>
      ))}
      <div className="animator-editor__triggers">
        {triggers.map((p) => (
          <button
            key={p.name}
            type="button"
            className="button"
            onClick={() => {
              if (runtime.current) fireTrigger(runtime.current, p.name, performance.now());
            }}
          >
            {p.name}
          </button>
        ))}
      </div>
    </section>
  );
}
