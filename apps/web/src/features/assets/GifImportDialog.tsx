import {
  CHARACTER_MAX_SIZE,
  FRAME_LIMIT,
  FRAME_MS_MAX,
  FRAME_MS_MIN,
  MOTION_KEYS,
  PALETTE_MAX_COLORS,
} from '@metacode/shared';
import { useEffect, useMemo, useState } from 'react';
import { ANIMATION_LIMIT, type PixelDocument } from './editorModel';
import {
  type Anchor,
  type DecodedGif,
  detectPixelScale,
  expandByDelays,
  frameMsOf,
  mirrorPixels,
  oppositeAnimation,
  shrinkRgba,
} from './gif';
import { quantizeFrames } from './png';

export interface GifFile {
  name: string;
  gif: DecodedGif;
}

/** 새 모션으로 넣기 (select의 값) */
const NEW_MOTION = 'new-motion';
/** 숫자 키 없는 새 애니메이션으로 넣기 (애니메이터의 상태가 틀 것, select의 값) */
const NEW_ANIMATION = 'new-animation';

/** 파일 이름에서 확장자를 뺀 것 (walk-left.gif → walk-left) */
const baseName = (name: string) => name.replace(/\.[^.]+$/, '');

/** 키운 도트 그림은 원래 크기로 줄이고, 그래도 크면 정수배로 더 줄인 그림 */
function prepare(file: GifFile, maxSide: number) {
  const { gif } = file;
  const scale = detectPixelScale(gif);
  let width = Math.floor(gif.width / scale);
  let height = Math.floor(gif.height / scale);
  let frames = gif.frames.map((f) => shrinkRgba(f, gif.width, gif.height, scale));
  // 에디터가 다룰 수 있는 크기보다 크면 정수배로 더 줄인다.
  const extra = Math.max(1, Math.ceil(Math.max(width, height) / maxSide));
  if (extra > 1) {
    frames = frames.map((f) => shrinkRgba(f, width, height, extra));
    width = Math.floor(width / extra);
    height = Math.floor(height / extra);
  }
  const frameMs = frameMsOf(gif.delays, FRAME_MS_MIN, FRAME_MS_MAX);
  // 장면마다 시간이 다르면 같은 장면을 되풀이해 시간을 맞춘다 (저장할 때는 한 장). 다만 애니메이션 하나가
  // 가리킬 수 있는 프레임 수(FRAME_LIMIT.character)를 넘으면 되풀이하지 않는다: 예전엔 장면이 많은 GIF가
  // 몇 배로 늘어나 저장할 때 알아보기 힘든 오류로 막혔다.
  const expanded = expandByDelays(frames, gif.delays, frameMs);
  return {
    name: file.name,
    width,
    height,
    frames: expanded.length <= FRAME_LIMIT.character ? expanded : frames,
    /** 서로 다른 장면 수 (프레임 한도는 이것으로 센다) */
    scenes: frames.length,
    scale: scale * extra,
    frameMs,
  };
}

/**
 * GIF 가져오기: 파일마다 장면들을 애니메이션 하나로 넣는다. 파일 이름이 애니메이션 이름(walk-left 등)이면
 * 그 애니메이션으로, 아니면 지금 고른 애니메이션(캐릭터에 여러 파일이면 새 모션)으로 정해 두고 바꿀 수 있다.
 * 키운 도트 그림은 원래 크기로 줄이고, 캐릭터는 그림이 들어가도록 해상도를 넓힌다(최대 512px).
 * 왼쪽·오른쪽 애니메이션이면 반대쪽을 좌우 반전으로 함께 만든다.
 */
export function GifImportDialog({
  editor,
  files,
  current,
  onClose,
  onDone,
  source = 'GIF',
  forAnimator = false,
}: {
  editor: PixelDocument;
  files: GifFile[];
  /** 지금 고른 애니메이션 번호 */
  current: number;
  onClose(): void;
  onDone(first: number | null, message: string): void;
  /** 어디서 가져오는지 (제목과 안내에 씀): GIF 또는 유니티 클립 */
  source?: 'GIF' | '유니티 클립';
  /** 애니메이터에서 상태를 만들려고 연 것: 처음부터 새 애니메이션으로 넣게 골라 둔다 */
  forAnimator?: boolean;
}) {
  const { doc } = editor;
  const character = doc.kind === 'character';
  const maxSide = character ? CHARACTER_MAX_SIZE : Math.max(doc.width, doc.height);
  const prepared = useMemo(() => files.map((f) => prepare(f, maxSide)), [files, maxSide]);
  const freeKeys = character ? editor.freeMotionKeys().length : 0;

  const defaultTarget = (name: string): string => {
    if (forAnimator && character) return NEW_ANIMATION;
    const base = baseName(name).toLowerCase();
    const match = doc.animations.findIndex(
      (a) => a.name === base || a.label?.toLowerCase() === base,
    );
    if (match !== -1) return String(match);
    if (files.length > 1 && character && freeKeys > 0) return NEW_MOTION;
    return String(current);
  };
  const [targets, setTargets] = useState(() => files.map((f) => defaultTarget(f.name)));
  const [mirror, setMirror] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // 아래의 도트 에디터까지 닫히지 않게 한다.
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const width = character ? Math.max(doc.width, ...prepared.map((p) => p.width)) : doc.width;
  const height = character ? Math.max(doc.height, ...prepared.map((p) => p.height)) : doc.height;
  const tooBig = !character && prepared.some((p) => p.width > doc.width || p.height > doc.height);
  const newMotions = targets.filter((t) => t === NEW_MOTION).length;
  const tooManyMotions = newMotions > freeKeys;
  const newAnimations = targets.filter((t) => t === NEW_MOTION || t === NEW_ANIMATION).length;
  const tooManyAnimations = doc.animations.length + newAnimations > ANIMATION_LIMIT;
  const frameTotal = prepared.reduce((sum, p) => sum + p.scenes, 0);
  const tooManyFrames = frameTotal > FRAME_LIMIT[doc.kind];

  const apply = () => {
    if (character && (width !== doc.width || height !== doc.height)) {
      editor.resizeCharacter(width, height);
    }
    const target = editor.doc;
    const anchor: Anchor =
      target.kind === 'character'
        ? 'bottom-center'
        : target.kind === 'object'
          ? 'bottom-left'
          : 'top-left';
    const placed = prepared.map((p) =>
      p.frames.map((rgba) => ({ rgba, width: p.width, height: p.height })),
    );
    // 모든 파일의 색을 함께 팔레트에 맞춘다.
    const all = placed.flat();
    const canvasFrames = all.map(({ rgba, width: w, height: h }) => {
      const out = new Uint8ClampedArray(target.width * target.height * 4);
      const dx = anchor === 'bottom-center' ? Math.floor((target.width - w) / 2) : 0;
      const dy = anchor === 'top-left' ? 0 : target.height - h;
      for (let y = 0; y < h; y++) {
        const ty = y + dy;
        if (ty < 0 || ty >= target.height) continue;
        for (let x = 0; x < w; x++) {
          const tx = x + dx;
          if (tx < 0 || tx >= target.width) continue;
          out.set(
            rgba.subarray((y * w + x) * 4, (y * w + x) * 4 + 4),
            (ty * target.width + tx) * 4,
          );
        }
      }
      return out;
    });
    const { frames, palette } = quantizeFrames(
      canvasFrames,
      target.width,
      target.height,
      target.palette,
    );
    let offset = 0;
    const entries = prepared.map((p, i) => {
      const own = frames.slice(offset, offset + p.frames.length);
      offset += p.frames.length;
      return {
        target:
          targets[i] === NEW_MOTION
            ? { motion: baseName(p.name) }
            : targets[i] === NEW_ANIMATION
              ? { animation: baseName(p.name) }
              : Number(targets[i]),
        frames: own,
        frameMs: p.frameMs,
        mirror,
      };
    });
    const first = editor.importAnimations(entries, palette, (pixels) =>
      mirrorPixels(pixels, target.width, target.height),
    );
    onDone(
      first,
      `${frameTotal}장을 가져왔습니다.${
        prepared.some((p) => p.scale > 1) ? ' 키운 도트 그림은 원래 크기로 줄였습니다.' : ''
      }`,
    );
  };

  return (
    <div className="dialog__overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="dialog gif-import"
        role="dialog"
        aria-modal="true"
        aria-label={`${source} 가져오기`}
      >
        <header className="dialog__header">
          <h2>{source} 가져오기</h2>
        </header>
        <ul className="gif-import__files">
          {prepared.map((p, i) => (
            <li key={`${p.name}-${i}`}>
              <div>
                <strong title={p.name}>{p.name}</strong>
                <small>
                  {p.scenes}장 · {p.width}×{p.height}px
                  {p.scale > 1 ? ` (${p.scale}배로 키운 그림을 줄임)` : ''} · {p.frameMs}ms
                </small>
              </div>
              <select
                value={targets[i]}
                aria-label={`${p.name}을 넣을 애니메이션`}
                onChange={(e) =>
                  setTargets((list) => list.map((t, j) => (j === i ? e.target.value : t)))
                }
              >
                {doc.animations.map((a, index) => (
                  <option key={a.name} value={index}>
                    {a.label ?? a.name}
                  </option>
                ))}
                {character && freeKeys > 0 && (
                  <option value={NEW_MOTION}>+ 새 모션으로 추가 (숫자 키)</option>
                )}
                {character && (
                  <option value={NEW_ANIMATION}>+ 새 애니메이션으로 추가 (애니메이터용)</option>
                )}
              </select>
            </li>
          ))}
        </ul>
        {/* 반대쪽 애니메이션이 있을 때만 (횡스크롤용 캐릭터는 왼쪽을 그리지 않으면 광장이 저절로 뒤집는다) */}
        {doc.animations.some((a, index) => {
          const opposite = oppositeAnimation(a.name);
          return (
            targets.includes(String(index)) &&
            !!opposite &&
            doc.animations.some((b) => b.name === opposite)
          );
        }) && (
          <label className="pixel-editor__check">
            <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />
            왼쪽·오른쪽 애니메이션이면 반대쪽도 좌우 반전해서 함께 만들기
          </label>
        )}
        {character && (width !== doc.width || height !== doc.height) && (
          <p className="form__hint">
            그림이 들어가도록 해상도를 {doc.width}×{doc.height}에서 {width}×{height}로 넓힙니다
            (그린 그림은 발밑 가운데에 그대로 남습니다).
          </p>
        )}
        <p className="form__hint">
          색은 지금 팔레트에 더하고, {PALETTE_MAX_COLORS}색이 넘으면 가까운 색으로 줄입니다. 그
          애니메이션의 프레임은
          {source} 장면으로 바뀝니다 (되돌리기로 돌아갈 수 있음). 장면마다 시간이 다르면 같은 장면을
          되풀이해 맞춥니다.
        </p>
        {tooBig && (
          <p className="form__error">
            {source} 그림이 이 에셋({doc.width}×{doc.height})보다 큽니다. 오브젝트는 크기를 먼저
            넓혀 주세요.
          </p>
        )}
        {tooManyMotions && (
          <p className="form__error">
            숫자 키가 {freeKeys}개 남아 있어 새 모션을 {newMotions}개 만들 수 없습니다 (모션은
            {` ${MOTION_KEYS.length}`}개까지).
          </p>
        )}
        {tooManyAnimations && (
          <p className="form__error">
            애니메이션은 {ANIMATION_LIMIT}개까지라 새로 {newAnimations}개를 더할 수 없습니다 (지금{' '}
            {doc.animations.length}개).
          </p>
        )}
        {tooManyFrames && (
          <p className="form__error">
            프레임이 너무 많습니다 ({frameTotal}장, {FRAME_LIMIT[doc.kind]}장까지).
          </p>
        )}
        <div className="form__actions">
          <button type="button" className="button" onClick={onClose}>
            취소
          </button>
          <button
            type="button"
            className="button button--primary"
            disabled={tooBig || tooManyMotions || tooManyAnimations || tooManyFrames}
            onClick={apply}
          >
            가져오기
          </button>
        </div>
      </div>
    </div>
  );
}
