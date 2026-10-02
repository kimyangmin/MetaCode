import {
  ASSET_NAME_MAX_LENGTH,
  CHARACTER_MAX_SIZE,
  CHARACTER_MIN_SIZE,
  CHARACTER_PLAZA_HEIGHTS,
  CHARACTER_PLAZA_HEIGHT_DEFAULT,
  FRAME_LIMIT,
  FRAME_MS_MAX,
  FRAME_MS_MIN,
  MOTION_LABEL_MAX_LENGTH,
  OBJECT_MAX_TILES,
  PALETTE_MAX_COLORS,
  PLAZA_STYLES,
  PlazaStyle,
  STANDARD_ANIMATIONS,
  TILE_SIZE,
  assetManifestSchema,
  decodeFrame,
} from '@metacode/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useUnsavedGuard } from './unsavedGuard';
import { ApiError } from '../../api/client';
import { isKeyboardClaimed } from '../../ui/keyboardClaim';
import { KeyCapture } from '../../ui/KeyCapture';
import { Select } from '../../ui/Select';
import { saveAsset } from './api';
import { AnimatorEditor, withStatesFor } from './AnimatorEditor';
import {
  BRUSH_MAX,
  BRUSH_MIN,
  type EditorAnimation,
  type EditorDoc,
  type FrameRef,
  PixelDocument,
  fromManifest,
  brushCells,
  isMotion,
  requiredOf,
  toManifest,
} from './editorModel';
import type { EditorTarget } from './editorStore';
import { type GifFile, GifImportDialog } from './GifImportDialog';
import { decodeGif, downloadBytes, encodeGif } from './gif';
import { canvasPngBytes, frameCanvas } from './pixelCanvas';
import { downloadCanvas, indexImage, readImageFile } from './png';
import {
  type Clip,
  type Point,
  type Rect,
  clearMasked,
  copyClip,
  flipWithin,
  isEmptyMask,
  lassoMask,
  maskBounds,
  maskOutline,
  maskedValues,
  placeClip,
  rectFrom,
  shiftPixels,
  stamp,
} from './selection';
import {
  type RgbaImage,
  type SheetSprite,
  type UnitySpriteMeta,
  clipToFrames,
  parseAnimClip,
  parseSpriteMeta,
  randomGuid,
  spriteFileId,
  writeAnimClip,
  writeSpriteMeta,
} from './unityAnim';
import { zipFiles } from './zip';
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eraser,
  FlipHorizontal2,
  FlipVertical2,
  Ghost,
  Lasso,
  Maximize2,
  Minus,
  PaintBucket,
  Pencil,
  Pipette,
  Plus,
  Redo2,
  Repeat2,
  Scissors,
  Undo2,
  Workflow,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

type Tool = 'pen' | 'eraser' | 'fill' | 'picker' | 'lasso' | 'crop';

const TOOLS: { id: Tool; label: string; icon: ReactNode; key: string }[] = [
  { id: 'pen', label: '연필', icon: <Pencil aria-hidden />, key: 'b' },
  { id: 'eraser', label: '지우개', icon: <Eraser aria-hidden />, key: 'e' },
  { id: 'fill', label: '채우기', icon: <PaintBucket aria-hidden />, key: 'g' },
  { id: 'picker', label: '스포이트', icon: <Pipette aria-hidden />, key: 'i' },
  { id: 'lasso', label: '올가미 (고른 곳을 끌어 옮기기)', icon: <Lasso aria-hidden />, key: 'l' },
  { id: 'crop', label: '자르기', icon: <Scissors aria-hidden />, key: 'c' },
];

/**
 * 올가미로 고른 영역. 고른 프레임(key)에서 마지막으로 바꾼 뒤(version) 다른 편집이 없을 때만 살아 있다.
 * lifted가 있으면 떠 있는 상태다: 프레임 = base 위에 values를 얹은 것이라, 옮길 때마다 base에서 다시 만든다
 * (옮기며 지나간 자리의 그림이 지워지지 않게).
 */
interface Selection {
  key: string;
  version: number;
  mask: Uint8Array;
  lifted: { base: Uint16Array; values: Uint16Array } | null;
}

type Drag =
  | { kind: 'stroke'; last: Point; value: number }
  | { kind: 'lasso' }
  | {
      kind: 'move';
      start: Point;
      moved: Point;
      begun: boolean;
      mask: Uint8Array;
      base: Uint16Array;
      values: Uint16Array;
    }
  | { kind: 'crop'; start: Point };

const TRIM_FEET_KEY = 'metacode:editor-trim-feet';

function trimMessage(trimmed: { animations: number; rows: number }): string {
  return `애니메이션 ${trimmed.animations}개의 발 아래 빈 줄을 정리했습니다 (최대 ${trimmed.rows}줄).`;
}

const TRIM_MARGINS_KEY = 'metacode:editor-trim-margins';

function marginMessage(cut: { top: number; sides: number }): string {
  const parts = [
    ...(cut.top ? [`머리 위 ${cut.top}줄`] : []),
    ...(cut.sides ? [`양옆 ${cut.sides}칸씩`] : []),
  ];
  return `${parts.join(', ')} 빈 곳을 잘라 해상도를 줄였습니다.`;
}

/** 자동 정리 설정 (기본 켬). 켜고 끈 것은 이 기기에 기억한다 */
function readTrim(key: string): boolean {
  try {
    return localStorage.getItem(key) !== 'off';
  } catch {
    return true;
  }
}

function saveTrim(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? 'on' : 'off');
  } catch {
    // 기억하지 못해도 이번 편집에는 적용된다.
  }
}

const readTrimFeet = () => readTrim(TRIM_FEET_KEY);
const readTrimMargins = () => readTrim(TRIM_MARGINS_KEY);

const BRUSH_KEY = 'metacode:editor-brush';

function readBrush(): number {
  try {
    const value = Number(localStorage.getItem(BRUSH_KEY));
    return value >= BRUSH_MIN && value <= BRUSH_MAX ? Math.round(value) : BRUSH_MIN;
  } catch {
    return BRUSH_MIN;
  }
}

function saveBrush(size: number) {
  try {
    localStorage.setItem(BRUSH_KEY, String(size));
  } catch {
    // 기억하지 못해도 이번 편집에는 쓴다.
  }
}

/** 처음 열 때의 배율 (그림이 480px 안팎으로 보이게). Ctrl+0이 이 배율로 돌아간다 */
const fitZoom = (width: number, height: number) =>
  Math.max(1, Math.min(28, Math.floor(480 / Math.max(width, height))));
const zoomIn = (z: number) => (z < 2 ? 2 : Math.min(40, z + 2));
const zoomOut = (z: number) => (z > 2 ? z - 2 : 1);
/** Ctrl+휠: 이만큼 모이면 한 단계 (트랙패드 모아 벌리기는 조금씩 온다) */
const WHEEL_STEP = 60;

/** 내보낼 파일 이름 (파일 시스템에서 쓸 수 없는 글자는 뺀다) */
const fileBase = (name: string) => name.trim().replace(/[\\/:*?"<>|]/g, '_') || 'asset';

const KIND_LABEL = { tile: '타일', object: '오브젝트', character: '캐릭터' } as const;

const ANIMATION_LABEL = new Map<string, string>([
  ...[...STANDARD_ANIMATIONS.values()].map((a) => [a.name, a.label] as const),
  ['default', '기본'],
]);

/** 애니메이션 목록에 보일 이름: 필수·점프는 정해진 이름, 모션은 사용자가 붙인 이름 */
/** 글을 쓰거나 값을 고르는 칸: 여기서 누른 키는 에디터 단축키로 쓰지 않는다 */
export const TYPING_TARGET = 'input, textarea, select, [role="combobox"]';

function animationLabel(animation: EditorAnimation): string {
  return animation.label ?? ANIMATION_LABEL.get(animation.name) ?? animation.name;
}

function initialDoc(target: EditorTarget): EditorDoc {
  return target.mode === 'create' ? target.doc : fromManifest(target.asset.manifest);
}

/**
 * 도트 에디터. 왼쪽 도구, 가운데 그림판, 오른쪽 팔레트·종류별 설정·애니메이션·미리보기, 아래 프레임 목록.
 * 왼쪽 버튼은 고른 색, 오른쪽 버튼은 지우개로 칠한다.
 */
export function PixelEditor({ target, onClose }: { target: EditorTarget; onClose(): void }) {
  const queryClient = useQueryClient();
  const [, setVersion] = useState(0);
  const [editor] = useState(
    () => new PixelDocument(initialDoc(target), () => setVersion((v) => v + 1)),
  );
  const [savedId, setSavedId] = useState(target.mode === 'edit' ? target.asset.id : undefined);
  const communityId = target.mode === 'create' ? target.communityId : target.asset.communityId;

  const doc = editor.doc;
  const [selected, setSelected] = useState<FrameRef>({ animation: 0, frame: 0 });
  const [tool, setTool] = useState<Tool>('pen');
  const [pickedColor, setColor] = useState(1);
  const [mirror, setMirror] = useState(false);
  const [onion, setOnion] = useState(false);
  const [zoom, setZoom] = useState(() => fitZoom(doc.width, doc.height));
  const [brush, setBrush] = useState(readBrush);
  /** 그림판 위 마우스 자리 (붓 굵기 미리보기) */
  const [hover, setHover] = useState<Point | null>(null);
  /** 머리글의 가져오기·내보내기 메뉴 */
  const [menu, setMenu] = useState<'import' | 'export' | null>(null);
  const [animatorOpen, setAnimatorOpen] = useState(false);
  const wheel = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [lassoPath, setLassoPath] = useState<Point[] | null>(null);
  const [crop, setCrop] = useState<{ rect: Rect; width: number; height: number } | null>(null);
  const [cropFit, setCropFit] = useState(false);
  const [clipboard, setClipboard] = useState<Clip | null>(null);
  const [trimFeet, setTrimFeet] = useState(readTrimFeet);
  const [trimMargins, setTrimMargins] = useState(readTrimMargins);
  const fileRef = useRef<HTMLInputElement>(null);
  // 해상도 칸에 입력해 두고 아직 적용하지 않은 크기를 적용한다 (저장하기 전에 부른다)
  const applyPendingSize = useRef<(() => void) | null>(null);
  const gifRef = useRef<HTMLInputElement>(null);
  const animatorGifRef = useRef<HTMLInputElement>(null);
  const unityRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState<{
    files: GifFile[];
    source: 'GIF' | '유니티 클립';
    /** 애니메이터의 "GIF로 상태": 가져오기 전의 애니메이션 이름 (새로 생긴 것마다 상태를 만든다) */
    forAnimator?: ReadonlySet<string>;
  } | null>(null);
  /** 붓 굵기를 step만큼 (키를 빠르게 여러 번 눌러도 하나씩 쌓이게 앞 값에서 센다) */
  const stepBrush = (step: number) =>
    setBrush((size) => {
      const next = Math.max(BRUSH_MIN, Math.min(BRUSH_MAX, size + step));
      saveBrush(next);
      return next;
    });

  // 되돌리기 등으로 애니메이션·프레임 수가 바뀌어도 고른 프레임이 범위 안에 있게 한다.
  const animation = doc.animations[Math.min(selected.animation, doc.animations.length - 1)]!;
  const ref: FrameRef = {
    animation: Math.min(selected.animation, doc.animations.length - 1),
    frame: Math.min(selected.frame, animation.frames.length - 1),
  };
  const pixels = animation.frames[ref.frame]!;
  // 되돌리기로 팔레트가 줄면(색 추가를 되돌림 등) 고른 색이 팔레트 밖일 수 있어 마지막 색으로 맞춘다.
  // 예전엔 팔레트에 없는 값으로 칠해져 보이지 않았고, 저장하면 "팔레트에 없는 색"으로 막혔다.
  const color = Math.max(1, Math.min(pickedColor, doc.palette.length));
  const missing = editor.missingAnimations();
  const requiredNames = new Set(requiredOf(doc).map((r) => r.name));
  const sideCharacter = doc.kind === 'character' && doc.style === PlazaStyle.SideScroll;
  const frameCount = editor.frameCount();
  const missingNames = new Set(missing.map((m) => m.name));
  const frameKey = `${ref.animation}:${ref.frame}`;
  // 다른 편집(붓질, 되돌리기, 크기 바꾸기)을 하거나 프레임을 옮기면 선택이 풀린다.
  const active =
    selection &&
    selection.key === frameKey &&
    selection.version === editor.version &&
    selection.mask.length === pixels.length
      ? selection
      : null;
  // 다른 도구로 바꾸면 자르기 사각형은 숨긴다 (다시 고르면 보임).
  const cropRect =
    tool === 'crop' && crop && crop.width === doc.width && crop.height === doc.height
      ? crop.rect
      : null;
  const canFit = doc.kind === 'character' || doc.kind === 'object';

  /** 팔레트에서 색을 고른다 (지우개·스포이트였으면 연필로) */
  const pickColor = useCallback((value: number) => {
    setColor(value);
    setTool((t) => (t === 'eraser' || t === 'picker' ? 'pen' : t));
  }, []);

  /** 닫기를 확인받았다 (창을 닫을 때 브라우저가 한 번 더 묻지 않게) */
  const discarding = useRef(false);
  const requestClose = useCallback(() => {
    if (editor.dirty && !window.confirm('저장하지 않은 변경이 있습니다. 닫을까요?')) return;
    discarding.current = true;
    onClose();
  }, [editor, onClose]);
  useUnsavedGuard(editor, discarding);

  // ── 선택 영역 ──

  /** 떠 있는 선택을 (dx, dy)만큼 옮긴 결과로 프레임을 다시 만든다 */
  const floatTo = (
    from: { mask: Uint8Array; base: Uint16Array; values: Uint16Array },
    dx: number,
    dy: number,
  ) => {
    const { width, height } = doc;
    const mask = shiftPixels(from.mask, width, height, dx, dy);
    const values = shiftPixels(from.values, width, height, dx, dy);
    editor.setFrame(ref, stamp(from.base, values, mask));
    setSelection({
      key: frameKey,
      version: editor.version,
      mask,
      lifted: { base: from.base, values },
    });
  };

  const lift = (sel: Selection) =>
    sel.lifted ?? {
      base: clearMasked(pixels, sel.mask),
      values: maskedValues(pixels, sel.mask),
    };

  const select = (mask: Uint8Array) =>
    setSelection(
      isEmptyMask(mask) ? null : { key: frameKey, version: editor.version, mask, lifted: null },
    );

  const nudge = (dx: number, dy: number) => {
    if (!active) return;
    editor.begin();
    floatTo({ mask: active.mask, ...lift(active) }, dx, dy);
  };

  /** 고른 곳을 그 자리(감싸는 사각형 안)에서 좌우(x)·상하(y)로 뒤집는다. 뒤집은 채로 떠 있어 옮길 수 있다 */
  const flipSelection = (axis: 'x' | 'y') => {
    if (!active) return;
    const rect = maskBounds(active.mask, doc.width);
    if (!rect) return;
    editor.begin();
    const from = lift(active);
    const mask = flipWithin(active.mask, rect, doc.width, axis);
    const values = flipWithin(from.values, rect, doc.width, axis);
    editor.setFrame(ref, stamp(from.base, values, mask));
    setSelection({
      key: frameKey,
      version: editor.version,
      mask,
      lifted: { base: from.base, values },
    });
  };

  const deleteSelection = () => {
    if (!active) return;
    editor.begin();
    // 떠 있으면 얹은 것만 치운다 (아래 그림은 남음).
    editor.setFrame(ref, active.lifted ? active.lifted.base : clearMasked(pixels, active.mask));
    setSelection(null);
  };

  const copySelection = () => {
    if (!active) return false;
    const clip = copyClip(active.lifted?.values ?? pixels, active.mask, doc.width);
    if (clip) setClipboard(clip);
    return !!clip;
  };

  /** 복사한 자리에 떠 있는 채로 붙인다 (다른 프레임에 붙여도 같은 자리라 애니메이션을 맞추기 쉽다) */
  const paste = () => {
    if (!clipboard) return;
    const placed = placeClip(clipboard, doc.width, doc.height);
    if (isEmptyMask(placed.mask)) return;
    editor.begin();
    const base = Uint16Array.from(pixels);
    editor.setFrame(ref, stamp(base, placed.values, placed.mask));
    setSelection({
      key: frameKey,
      version: editor.version,
      mask: placed.mask,
      lifted: { base, values: placed.values },
    });
    setTool('lasso');
  };

  const applyCrop = (allFrames: boolean) => {
    if (!cropRect) return;
    editor.crop(cropRect, allFrames ? undefined : ref, allFrames && cropFit && canFit);
    setCrop(null);
  };

  const selectFrame = (frame: number) => setSelected({ animation: ref.animation, frame });
  /**
   * 앞·뒤 프레임으로 넘긴다 (끝에서는 반대쪽 끝으로). 고른 번호는 지금 애니메이션의 범위 안에서만 바꾼다:
   * 예전엔 오른쪽 방향키가 범위를 넘어 번호를 계속 올려서, 끝에 닿은 뒤에는 왼쪽으로 돌아오지 않는 것처럼 보였다.
   */
  const stepFrame = (step: 1 | -1) => {
    const count = animation.frames.length;
    selectFrame((ref.frame + step + count) % count);
  };

  // ── 키보드 ── (매번 새로 걸어 지금 선택 상태를 쓴다)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // GIF 가져오기 창이 떠 있으면 그 창이 키를 받는다. 예전엔 그 창에서 Esc를 누르면 창과 함께 에디터까지
      // 닫으려 했고, 도구 단축키·되돌리기도 뒤의 그림에 먹었다.
      if (importing || e.defaultPrevented || isKeyboardClaimed()) return;
      // 애니메이터의 도움말·스킬 만들기 창이 떠 있으면 그 창이 키를 받는다 (Esc로 그 창만 닫힘)
      if (rootRef.current?.querySelector('.dialog__overlay')) return;
      const target = e.target as HTMLElement;
      if (menu && e.key === 'Escape') {
        e.preventDefault();
        setMenu(null);
        return;
      }
      // 애니메이터 화면: Esc는 그림으로 돌아가고, 되돌리기만 받는다 (그리기 단축키는 쓰지 않음)
      if (animatorOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setAnimatorOpen(false);
          return;
        }
        if (target.closest(TYPING_TARGET)) return;
        const undoKey = (e.ctrlKey || e.metaKey) && e.key.toLowerCase();
        if (undoKey === 'z') {
          e.preventDefault();
          if (e.shiftKey) editor.redo();
          else editor.undo();
        } else if (undoKey === 'y') {
          e.preventDefault();
          editor.redo();
        }
        return;
      }
      if (e.key === 'Escape') {
        // 설정 창이 함께 닫히지 않게 한다 (설정 창은 defaultPrevented를 보고 무시한다).
        e.preventDefault();
        if (cropRect) setCrop(null);
        else if (active || lassoPath) {
          setSelection(null);
          setLassoPath(null);
        } else requestClose();
        return;
      }
      if (target.closest(TYPING_TARGET)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) editor.redo();
        else editor.undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        editor.redo();
      } else if (
        mod &&
        (e.code === 'Equal' || e.code === 'NumpadAdd' || key === '=' || key === '+')
      ) {
        // 브라우저 확대 대신 그림판을 키운다
        e.preventDefault();
        setZoom(zoomIn);
      } else if (mod && (e.code === 'Minus' || e.code === 'NumpadSubtract' || key === '-')) {
        e.preventDefault();
        setZoom(zoomOut);
      } else if (mod && (e.code === 'Digit0' || e.code === 'Numpad0')) {
        e.preventDefault();
        setZoom(fitZoom(doc.width, doc.height));
      } else if (mod && key === 'a') {
        e.preventDefault();
        select(new Uint8Array(pixels.length).fill(1));
        setTool('lasso');
      } else if (mod && key === 'c') {
        if (copySelection()) e.preventDefault();
      } else if (mod && key === 'x') {
        if (copySelection()) {
          e.preventDefault();
          deleteSelection();
        }
      } else if (mod && key === 'v') {
        e.preventDefault();
        paste();
      } else if (!mod) {
        const found = TOOLS.find((t) => t.key === key);
        // 고른 곳이 있으면 H는 좌우, Shift+H는 상하로 뒤집는다
        if (active && e.code === 'KeyH') flipSelection(e.shiftKey ? 'y' : 'x');
        else if (found) setTool(found.id);
        else if (key === 'm') setMirror((v) => !v);
        else if (key === 'o') setOnion((v) => !v);
        else if (e.code === 'BracketLeft') stepBrush(-1);
        else if (e.code === 'BracketRight') stepBrush(1);
        else if ((e.key === 'Delete' || e.key === 'Backspace') && active) {
          e.preventDefault();
          deleteSelection();
        } else if (e.key === 'Enter' && cropRect) {
          e.preventDefault();
          applyCrop(true);
        } else if (arrows[e.key] && active) {
          // 고른 영역이 있으면 방향키는 한 칸씩 옮긴다 (없으면 프레임 넘기기).
          e.preventDefault();
          nudge(...arrows[e.key]!);
        } else if (e.key === 'ArrowLeft') stepFrame(-1);
        else if (e.key === 'ArrowRight') stepFrame(1);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // ── 그림판 ──
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  // Ctrl+휠의 브라우저 확대를 막는다 (React의 onWheel은 passive라 막을 수 없음). 애니메이터를 닫으면
  // 그림판이 다시 생기므로 그때 다시 건다.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const block = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    stage.addEventListener('wheel', block, { passive: false });
    return () => stage.removeEventListener('wheel', block);
  }, [animatorOpen]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const { width, height } = doc;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const previous = animation.frames[ref.frame - 1];
    if (onion && previous) {
      ctx.globalAlpha = 0.3;
      ctx.drawImage(
        frameCanvas(previous, width, height, doc.palette),
        0,
        0,
        canvas.width,
        canvas.height,
      );
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(
      frameCanvas(pixels, width, height, doc.palette),
      0,
      0,
      canvas.width,
      canvas.height,
    );
    // 막힌 칸 (오브젝트)
    if (doc.kind === 'object') {
      const cols = width / TILE_SIZE;
      ctx.fillStyle = 'rgba(232, 69, 55, 0.18)';
      doc.footprint.forEach((blocked, i) => {
        if (!blocked) return;
        const s = TILE_SIZE * zoom;
        ctx.fillRect((i % cols) * s, Math.floor(i / cols) * s, s, s);
      });
    }
    // 격자: 픽셀마다 옅게, 타일(16px)마다 진하게
    if (zoom >= 6) {
      ctx.strokeStyle = 'rgba(128, 128, 128, 0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 1; x < width; x++) {
        ctx.moveTo(x * zoom + 0.5, 0);
        ctx.lineTo(x * zoom + 0.5, canvas.height);
      }
      for (let y = 1; y < height; y++) {
        ctx.moveTo(0, y * zoom + 0.5);
        ctx.lineTo(canvas.width, y * zoom + 0.5);
      }
      ctx.stroke();
    }
    // 굵은 격자 = 월드 타일 경계. 타일·오브젝트는 16px마다지만, 캐릭터는 해상도와 상관없이
    // 광장 크기(기본 세로 2타일)를 차지하므로 가로 전체가 한 칸이고, 세로는 발밑에서부터 1타일마다 선이 있다.
    ctx.strokeStyle = 'rgba(128, 128, 128, 0.6)';
    ctx.beginPath();
    if (doc.kind === 'character') {
      const tile = height / doc.plazaHeight;
      for (let y = height - tile; y > 0.5; y -= tile) {
        const py = Math.round(y * zoom) + 0.5;
        ctx.moveTo(0, py);
        ctx.lineTo(canvas.width, py);
      }
    } else {
      for (let x = TILE_SIZE; x < width; x += TILE_SIZE) {
        ctx.moveTo(x * zoom + 0.5, 0);
        ctx.lineTo(x * zoom + 0.5, canvas.height);
      }
      for (let y = TILE_SIZE; y < height; y += TILE_SIZE) {
        ctx.moveTo(0, y * zoom + 0.5);
        ctx.lineTo(canvas.width, y * zoom + 0.5);
      }
    }
    ctx.stroke();
    // 자르기: 남길 사각형 밖을 어둡게
    if (cropRect) {
      const x = cropRect.x * zoom;
      const y = cropRect.y * zoom;
      const w = cropRect.w * zoom;
      const h = cropRect.h * zoom;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(0, 0, canvas.width, y);
      ctx.fillRect(0, y + h, canvas.width, canvas.height - y - h);
      ctx.fillRect(0, y, x, h);
      ctx.fillRect(x + w, y, canvas.width - x - w, h);
      ctx.setLineDash([]);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
    // 선택 테두리 (흰 선 위에 검은 점선이라 어느 색 위에서도 보인다)
    const outline = (draw: () => void) => {
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      draw();
      ctx.stroke();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#000000';
      ctx.beginPath();
      draw();
      ctx.stroke();
      ctx.setLineDash([]);
    };
    if (active) {
      const edges = maskOutline(active.mask, width, height);
      outline(() => {
        for (const [x1, y1, x2, y2] of edges) {
          ctx.moveTo(x1 * zoom + 0.5, y1 * zoom + 0.5);
          ctx.lineTo(x2 * zoom + 0.5, y2 * zoom + 0.5);
        }
      });
    }
    if (lassoPath && lassoPath.length > 1) {
      outline(() => {
        lassoPath.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x * zoom, p.y * zoom);
          else ctx.lineTo(p.x * zoom, p.y * zoom);
        });
      });
    }
    // 붓 굵기 미리보기: 칠할 사각형 (좌우 대칭이면 반대쪽도)
    if (hover && (tool === 'pen' || tool === 'eraser') && !drag.current) {
      const cells = brushCells(hover.x, hover.y, brush);
      const x0 = cells[0]!.x;
      const y0 = cells[0]!.y;
      const boxes = [x0, ...(mirror ? [width - x0 - brush] : [])];
      outline(() => {
        for (const bx of boxes)
          ctx.rect(bx * zoom + 0.5, y0 * zoom + 0.5, brush * zoom - 1, brush * zoom - 1);
      });
    }
  });

  /** 픽셀 단위 실수 좌표 (올가미 선) */
  const exactAt = (e: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * doc.width,
      y: ((e.clientY - rect.top) / rect.height) * doc.height,
    };
  };

  const pointAt = (e: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const p = exactAt(e);
    return { x: Math.floor(p.x), y: Math.floor(p.y) };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.button !== 2) return;
    // preventDefault()로 포커스가 옮겨 가지 않으므로, 입력칸(해상도 등)에 쓰던 값이 blur로 적용되도록 직접 뺀다.
    // 예전엔 해상도를 입력하고 그림판을 누르면 적용되지 않아 그림판 크기가 그대로였다.
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused.matches('input, textarea, select'))
      focused.blur();
    e.preventDefault();
    const p = pointAt(e);
    if (tool === 'lasso' || tool === 'crop') {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      if (tool === 'crop') {
        drag.current = { kind: 'crop', start: p };
        setCrop({
          rect: rectFrom(p, p, doc.width, doc.height),
          width: doc.width,
          height: doc.height,
        });
      } else if (active && active.mask[p.y * doc.width + p.x]) {
        // 고른 곳을 누르면 끌어 옮긴다. 실제로 움직일 때 되돌리기 단계를 만든다.
        drag.current = {
          kind: 'move',
          start: p,
          moved: { x: 0, y: 0 },
          begun: false,
          mask: active.mask,
          ...lift(active),
        };
      } else {
        drag.current = { kind: 'lasso' };
        setSelection(null);
        setLassoPath([exactAt(e)]);
      }
      return;
    }
    const erase = e.button === 2 || tool === 'eraser';
    if (tool === 'picker' && e.button === 0) {
      const value = editor.pick(ref, p.x, p.y);
      if (value > 0) setColor(value);
      setTool(value > 0 ? 'pen' : 'eraser');
      return;
    }
    if (tool === 'fill') {
      editor.fill(ref, p.x, p.y, erase ? 0 : color);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    const value = erase ? 0 : color;
    editor.beginStroke();
    editor.paint(ref, p.x, p.y, value, mirror, brush);
    drag.current = { kind: 'stroke', last: p, value };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const at = pointAt(e);
    if (at.x !== hover?.x || at.y !== hover?.y) setHover(at);
    const current = drag.current;
    if (!current) return;
    if (current.kind === 'lasso') {
      const p = exactAt(e);
      setLassoPath((path) => (path ? [...path, p] : [p]));
      return;
    }
    const p = pointAt(e);
    if (current.kind === 'stroke') {
      editor.line(ref, current.last, p, current.value, mirror, brush);
      current.last = p;
    } else if (current.kind === 'crop') {
      setCrop({
        rect: rectFrom(current.start, p, doc.width, doc.height),
        width: doc.width,
        height: doc.height,
      });
    } else {
      const dx = p.x - current.start.x;
      const dy = p.y - current.start.y;
      if (dx === current.moved.x && dy === current.moved.y) return;
      if (!current.begun) {
        editor.begin();
        current.begun = true;
      }
      current.moved = { x: dx, y: dy };
      floatTo(current, dx, dy);
    }
  };

  const endDrag = () => {
    const current = drag.current;
    drag.current = null;
    if (current?.kind !== 'lasso') return;
    // 짧게 누르기만 하면 선택을 푼다.
    if (lassoPath && lassoPath.length >= 3) select(lassoMask(lassoPath, doc.width, doc.height));
    setLassoPath(null);
  };

  // ── 저장 ──
  const save = async () => {
    applyPendingSize.current?.();
    const trimmed = doc.kind === 'character' && trimFeet ? editor.trimBelowFeet() : null;
    // 발 아래를 먼저 내린 뒤 머리 위·양옆을 자른다 (내린 만큼 위가 더 비므로)
    const cut = doc.kind === 'character' && trimMargins ? editor.trimMargins() : null;
    const result = assetManifestSchema.safeParse(toManifest(editor.doc));
    // 이 버전을 저장한다 (기다리는 동안 더 고친 것은 저장하지 않은 것으로 남긴다)
    const version = editor.version;
    if (!result.success) {
      setStatus({ kind: 'error', text: result.error.issues.map((i) => i.message).join(' ') });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const asset = await saveAsset(queryClient, { id: savedId, communityId }, result.data);
      setSavedId(asset.id);
      editor.markSaved(version);
      setStatus({
        kind: 'ok',
        text: [
          '저장했습니다.',
          ...(trimmed?.animations ? [trimMessage(trimmed)] : []),
          ...(cut && (cut.top || cut.sides) ? [marginMessage(cut)] : []),
        ].join(' '),
      });
    } catch (err) {
      setStatus({
        kind: 'error',
        text:
          err instanceof ApiError || err instanceof Error ? err.message : '저장하지 못했습니다.',
      });
    } finally {
      setBusy(false);
    }
  };

  // ── PNG ──
  const onImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const image = await readImageFile(file);
      const result = indexImage(
        image.rgba,
        image.width,
        image.height,
        doc.width,
        doc.height,
        doc.palette,
      );
      if ('error' in result) {
        setStatus({ kind: 'error', text: result.error });
        return;
      }
      // 지금 있는 프레임과 합쳐 한도를 넘으면 가져오지 않는다 (예전엔 가져온 뒤 저장할 때에야 막혔다)
      const total = editor.frameCountIf((probe) =>
        probe.importFrames(ref, result.frames, result.palette),
      );
      if (total > FRAME_LIMIT[doc.kind]) {
        setStatus({
          kind: 'error',
          text: `가져오면 프레임이 ${total}장이 되어 한도(${FRAME_LIMIT[doc.kind]}장)를 넘습니다.`,
        });
        return;
      }
      editor.importFrames(ref, result.frames, result.palette);
      setStatus({ kind: 'ok', text: `${result.frames.length}프레임을 가져왔습니다.` });
    } catch {
      setStatus({ kind: 'error', text: '그림을 읽지 못했습니다.' });
    }
  };

  // ── GIF ──
  const onImportGif = async (e: ChangeEvent<HTMLInputElement>, forAnimator = false) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (files.length === 0) return;
    try {
      const decoded = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          gif: decodeGif(new Uint8Array(await file.arrayBuffer())),
        })),
      );
      setStatus(null);
      setImporting({
        files: decoded,
        source: 'GIF',
        forAnimator: forAnimator ? new Set(editor.doc.animations.map((a) => a.name)) : undefined,
      });
    } catch {
      setStatus({ kind: 'error', text: 'GIF를 읽지 못했습니다.' });
    }
  };

  // ── 유니티 ──

  /**
   * 유니티 .anim(+ 스프라이트 시트 PNG와 그 .meta)을 애니메이션으로. 클립마다 GIF 가져오기와 같은 창에서
   * 넣을 애니메이션을 고른다. PNG와 .meta는 이름(그림.png ↔ 그림.png.meta)으로, 하나씩이면 그대로 짝짓는다.
   */
  const onImportUnity = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (files.length === 0) return;
    const lower = (f: File) => f.name.toLowerCase();
    const anims = files.filter((f) => lower(f).endsWith('.anim'));
    const metas = files.filter((f) => lower(f).endsWith('.meta'));
    const pngs = files.filter((f) => lower(f).endsWith('.png'));
    if (anims.length === 0) {
      setStatus({ kind: 'error', text: '.anim 파일을 함께 골라 주세요 (그림 PNG와 .meta도).' });
      return;
    }
    try {
      const metaByGuid = new Map<string, UnitySpriteMeta>();
      const imageByGuid = new Map<string, RgbaImage>();
      for (const file of metas) {
        const meta = parseSpriteMeta(await file.text());
        if (!meta) continue;
        metaByGuid.set(meta.guid, meta);
        const png =
          pngs.find((p) => `${lower(p)}.meta` === lower(file)) ??
          (pngs.length === 1 && metas.length === 1 ? pngs[0] : undefined);
        if (png) imageByGuid.set(meta.guid, await readImageFile(png));
      }
      const clips: GifFile[] = [];
      const errors: string[] = [];
      for (const file of anims) {
        const clip = parseAnimClip(await file.text(), file.name.replace(/\.anim$/i, ''));
        if (!clip) {
          errors.push(`${file.name}: 스프라이트 애니메이션이 아닙니다.`);
          continue;
        }
        const result = clipToFrames(clip, metaByGuid, imageByGuid);
        if ('error' in result) errors.push(result.error);
        else clips.push({ name: `${clip.name}.anim`, gif: result.gif });
      }
      if (clips.length === 0) {
        setStatus({ kind: 'error', text: errors.join(' ') || '가져올 클립이 없습니다.' });
        return;
      }
      setStatus(errors.length > 0 ? { kind: 'error', text: errors.join(' ') } : null);
      setImporting({ files: clips, source: '유니티 클립' });
    } catch {
      setStatus({ kind: 'error', text: '유니티 파일을 읽지 못했습니다.' });
    }
  };

  /**
   * 모든 애니메이션을 유니티에서 쓸 수 있게 ZIP 하나로: 스프라이트 시트 PNG(같은 그림은 한 칸) + 그 .meta
   * (칸마다 발밑 가운데 기준점, 도트 그대로) + 애니메이션마다 .anim. 폴더째 유니티 Assets에 넣으면 된다.
   */
  const onExportUnity = async () => {
    const manifest = toManifest(editor.doc);
    const { width, height } = manifest;
    const count = manifest.frames.length;
    const cols = Math.max(1, Math.min(count, Math.floor(4096 / width)));
    const rows = Math.ceil(count / cols);
    const sheet = globalThis.document.createElement('canvas');
    sheet.width = cols * width;
    sheet.height = rows * height;
    const ctx = sheet.getContext('2d')!;
    const base = fileBase(doc.name);
    const sprites: SheetSprite[] = manifest.frames.map((frame, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const pixels = decodeFrame(frame, width * height) ?? new Uint16Array(width * height);
      ctx.drawImage(
        frameCanvas(pixels, width, height, manifest.palette),
        col * width,
        row * height,
      );
      // 유니티 사각형은 아래가 0
      return {
        name: `${base}_${i}`,
        fileID: spriteFileId(i),
        x: col * width,
        y: sheet.height - (row + 1) * height,
        width,
        height,
      };
    });
    const guid = randomGuid();
    const encoder = new TextEncoder();
    const once = new Set(['emote', 'jump-left', 'jump-right']);
    const clips = Object.entries(manifest.animations).map(([name, animation]) => ({
      name: `${base}/${name}.anim`,
      data: encoder.encode(
        writeAnimClip({
          name,
          guid,
          frames: animation.frames.map(spriteFileId),
          frameMs: animation.frameMs,
          loop: animation.key !== undefined ? !!animation.loop : !once.has(name),
        }),
      ),
    }));
    const zip = zipFiles([
      { name: `${base}/${base}.png`, data: await canvasPngBytes(sheet) },
      {
        name: `${base}/${base}.png.meta`,
        data: encoder.encode(writeSpriteMeta({ guid, sprites, pixelsPerUnit: TILE_SIZE })),
      },
      ...clips,
    ]);
    downloadBytes(zip, `${base}-unity.zip`, 'application/zip');
    setStatus({
      kind: 'ok',
      text: `유니티용으로 내보냈습니다 (스프라이트 ${count}칸, 애니메이션 ${clips.length}개).`,
    });
  };

  /** 지금 애니메이션을 움직이는 GIF로 (투명 배경, 작은 그림은 정수배로 키워서) */
  const onExportGif = () => {
    const scale = Math.max(1, Math.floor(256 / Math.max(doc.width, doc.height)));
    const bytes = encodeGif(
      animation.frames,
      doc.width,
      doc.height,
      doc.palette,
      animation.frameMs,
      scale,
    );
    downloadBytes(bytes, `${doc.name.trim() || 'asset'}-${animation.name}.gif`, 'image/gif');
  };

  const onExport = () => {
    const sheet = globalThis.document.createElement('canvas');
    sheet.width = doc.width * animation.frames.length;
    sheet.height = doc.height;
    const ctx = sheet.getContext('2d')!;
    animation.frames.forEach((frame, i) => {
      ctx.drawImage(frameCanvas(frame, doc.width, doc.height, doc.palette), i * doc.width, 0);
    });
    downloadCanvas(sheet, `${doc.name.trim() || 'asset'}-${animation.name}.png`);
  };

  return (
    <div
      ref={rootRef}
      className="pixel-editor"
      role="dialog"
      aria-modal="true"
      aria-label="도트 에디터"
    >
      <header className="pixel-editor__header">
        <span className="pixel-editor__kind">{KIND_LABEL[doc.kind]}</span>
        <input
          className="pixel-editor__name"
          value={doc.name}
          maxLength={ASSET_NAME_MAX_LENGTH}
          onChange={(e) => editor.setName(e.target.value)}
          aria-label="이름"
          placeholder="이름"
        />
        {status && (
          <p className={status.kind === 'ok' ? 'form__ok' : 'form__error'} role="status">
            {status.text}
          </p>
        )}
        <div className="pixel-editor__actions">
          <EditorMenu
            label="가져오기"
            open={menu === 'import'}
            onToggle={(open) => setMenu(open ? 'import' : null)}
            items={[
              {
                label: 'PNG',
                hint: '프레임 크기 그림 또는 가로로 이어 붙인 시트',
                run: () => fileRef.current?.click(),
              },
              {
                label: 'GIF',
                hint: '움직이는 GIF를 애니메이션으로 (여러 파일이면 파일 이름으로 정함)',
                run: () => gifRef.current?.click(),
              },
              {
                label: '유니티 .anim',
                hint: '.anim과 스프라이트 시트 PNG, 그 .meta를 함께 고르세요',
                run: () => unityRef.current?.click(),
              },
            ]}
          />
          <EditorMenu
            label="내보내기"
            open={menu === 'export'}
            onToggle={(open) => setMenu(open ? 'export' : null)}
            items={[
              { label: 'PNG', hint: '지금 애니메이션을 가로로 이어 붙인 시트', run: onExport },
              { label: 'GIF', hint: '지금 애니메이션을 움직이는 GIF로', run: onExportGif },
              {
                label: '유니티 .anim (ZIP)',
                hint: '모든 애니메이션: 스프라이트 시트 PNG + .meta + .anim',
                run: () => void onExportUnity(),
              },
            ]}
          />
          <button type="button" className="button" onClick={requestClose}>
            닫기
          </button>
          <button
            type="button"
            className="button button--primary"
            disabled={busy || missing.length > 0 || !doc.name.trim()}
            title={
              missing.length > 0 ? '필수 애니메이션을 모두 그려야 저장할 수 있습니다' : undefined
            }
            onClick={() => void save()}
          >
            저장
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png"
            hidden
            onChange={(e) => void onImport(e)}
          />
          <input
            ref={gifRef}
            type="file"
            accept="image/gif"
            multiple
            hidden
            onChange={(e) => void onImportGif(e)}
          />
          <input
            ref={animatorGifRef}
            type="file"
            accept="image/gif"
            multiple
            hidden
            onChange={(e) => void onImportGif(e, true)}
          />
          <input
            ref={unityRef}
            type="file"
            accept=".anim,.png,.meta"
            multiple
            hidden
            onChange={(e) => void onImportUnity(e)}
          />
        </div>
      </header>

      {animatorOpen && doc.kind === 'character' ? (
        <AnimatorEditor
          editor={editor}
          onClose={() => setAnimatorOpen(false)}
          onAddFromGif={() => animatorGifRef.current?.click()}
        />
      ) : (
        <>
          <div className="pixel-editor__body">
            <aside className="pixel-editor__tools" aria-label="도구">
              {TOOLS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="pixel-editor__tool"
                  aria-pressed={tool === t.id}
                  aria-label={t.label}
                  title={`${t.label} (${t.key.toUpperCase()})`}
                  onClick={() => setTool(t.id)}
                >
                  {t.icon}
                </button>
              ))}
              <div
                className="pixel-editor__brush"
                role="group"
                aria-label="붓 굵기"
                title="붓 굵기 ([ ])"
              >
                <button
                  type="button"
                  className="pixel-editor__tool"
                  disabled={brush >= BRUSH_MAX}
                  aria-label="붓 굵게"
                  title="붓 굵게 (])"
                  onClick={() => stepBrush(1)}
                >
                  <Plus aria-hidden />
                </button>
                <span aria-live="polite">{brush}px</span>
                <button
                  type="button"
                  className="pixel-editor__tool"
                  disabled={brush <= BRUSH_MIN}
                  aria-label="붓 가늘게"
                  title="붓 가늘게 ([)"
                  onClick={() => stepBrush(-1)}
                >
                  <Minus aria-hidden />
                </button>
              </div>
              <hr />
              <button
                type="button"
                className="pixel-editor__tool"
                aria-pressed={mirror}
                title="좌우 대칭 (M)"
                aria-label="좌우 대칭"
                onClick={() => setMirror((v) => !v)}
              >
                <FlipHorizontal2 aria-hidden />
              </button>
              <button
                type="button"
                className="pixel-editor__tool"
                aria-pressed={onion}
                title="앞 프레임 겹쳐 보기 (O)"
                aria-label="앞 프레임 겹쳐 보기"
                onClick={() => setOnion((v) => !v)}
              >
                <Ghost aria-hidden />
              </button>
              <hr />
              <button
                type="button"
                className="pixel-editor__tool"
                disabled={!editor.canUndo}
                title="되돌리기 (Ctrl+Z)"
                aria-label="되돌리기"
                onClick={() => editor.undo()}
              >
                <Undo2 aria-hidden />
              </button>
              <button
                type="button"
                className="pixel-editor__tool"
                disabled={!editor.canRedo}
                title="다시 하기 (Ctrl+Shift+Z)"
                aria-label="다시 하기"
                onClick={() => editor.redo()}
              >
                <Redo2 aria-hidden />
              </button>
              <hr />
              <button
                type="button"
                className="pixel-editor__tool"
                title="크게 (Ctrl + 또는 Ctrl+휠)"
                aria-label="크게"
                onClick={() => setZoom(zoomIn)}
              >
                <ZoomIn aria-hidden />
              </button>
              <button
                type="button"
                className="pixel-editor__tool"
                title="작게 (Ctrl − 또는 Ctrl+휠)"
                aria-label="작게"
                onClick={() => setZoom(zoomOut)}
              >
                <ZoomOut aria-hidden />
              </button>
              <button
                type="button"
                className="pixel-editor__tool"
                title="처음 크기로 (Ctrl 0)"
                aria-label="처음 크기로"
                onClick={() => setZoom(fitZoom(doc.width, doc.height))}
              >
                <Maximize2 aria-hidden />
              </button>
              <span className="pixel-editor__zoom" aria-live="polite">
                ×{zoom}
              </span>
            </aside>

            <div className="pixel-editor__main">
              {cropRect ? (
                <div className="pixel-editor__bar" role="toolbar" aria-label="자르기">
                  <span>
                    남길 곳 {cropRect.w}×{cropRect.h}px
                  </span>
                  <button
                    type="button"
                    className="button button--primary"
                    onClick={() => applyCrop(true)}
                    title="Enter"
                  >
                    모든 프레임 자르기
                  </button>
                  <button type="button" className="button" onClick={() => applyCrop(false)}>
                    이 프레임만
                  </button>
                  {canFit && (
                    <label className="pixel-editor__check">
                      <input
                        type="checkbox"
                        checked={cropFit}
                        onChange={(e) => setCropFit(e.target.checked)}
                      />
                      그림 크기도 맞추기
                    </label>
                  )}
                  <button
                    type="button"
                    className="button"
                    onClick={() => setCrop(null)}
                    title="Esc"
                  >
                    취소
                  </button>
                </div>
              ) : tool === 'crop' ? (
                <div className="pixel-editor__bar">
                  <span className="form__hint">남길 곳을 끌어서 고르세요. 밖은 지워집니다.</span>
                </div>
              ) : tool === 'lasso' || active ? (
                <div className="pixel-editor__bar" role="toolbar" aria-label="선택 영역">
                  {!active && (
                    <span className="form__hint">
                      둘러 그려서 고르고, 고른 곳을 끌어 옮깁니다 (방향키로 한 칸씩).
                    </span>
                  )}
                  <button
                    type="button"
                    className="button"
                    disabled={!active}
                    onClick={copySelection}
                    title="Ctrl+C"
                  >
                    복사
                  </button>
                  <button
                    type="button"
                    className="button"
                    disabled={!active}
                    onClick={() => {
                      if (copySelection()) deleteSelection();
                    }}
                    title="Ctrl+X"
                  >
                    잘라내기
                  </button>
                  <button
                    type="button"
                    className="button"
                    disabled={!clipboard}
                    onClick={paste}
                    title="Ctrl+V: 복사한 자리에 붙입니다"
                  >
                    붙여넣기
                  </button>
                  <button
                    type="button"
                    className="button"
                    disabled={!active}
                    onClick={() => flipSelection('x')}
                    title="H"
                  >
                    <FlipHorizontal2 aria-hidden /> 좌우 반전
                  </button>
                  <button
                    type="button"
                    className="button"
                    disabled={!active}
                    onClick={() => flipSelection('y')}
                    title="Shift+H"
                  >
                    <FlipVertical2 aria-hidden /> 상하 반전
                  </button>
                  <button
                    type="button"
                    className="button"
                    disabled={!active}
                    onClick={deleteSelection}
                    title="Delete"
                  >
                    지우기
                  </button>
                  <button
                    type="button"
                    className="button"
                    onClick={() => {
                      select(new Uint8Array(pixels.length).fill(1));
                      setTool('lasso');
                    }}
                    title="Ctrl+A"
                  >
                    전체 선택
                  </button>
                  <button
                    type="button"
                    className="button"
                    disabled={!active}
                    onClick={() => setSelection(null)}
                    title="Esc"
                  >
                    선택 해제
                  </button>
                </div>
              ) : null}
              <div
                className="pixel-editor__stage"
                onWheel={(e) => {
                  // Ctrl+휠(트랙패드 모아 벌리기)은 그림판 배율. 브라우저 확대는 아래 리스너가 막는다.
                  if (!e.ctrlKey && !e.metaKey) return;
                  wheel.current += e.deltaY;
                  while (Math.abs(wheel.current) >= WHEEL_STEP) {
                    setZoom(wheel.current < 0 ? zoomIn : zoomOut);
                    wheel.current -= Math.sign(wheel.current) * WHEEL_STEP;
                  }
                }}
                ref={stageRef}
              >
                <canvas
                  ref={canvasRef}
                  className="pixel-editor__canvas"
                  width={doc.width * zoom}
                  height={doc.height * zoom}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onPointerLeave={() => setHover(null)}
                  onContextMenu={(e) => e.preventDefault()}
                />
              </div>
            </div>

            <aside className="pixel-editor__side">
              <section>
                <h3>팔레트</h3>
                <PaletteSwatches
                  palette={doc.palette}
                  version={editor.version}
                  selected={tool === 'eraser' ? 0 : color}
                  onPick={pickColor}
                />
                <div className="pixel-editor__row">
                  <input
                    type="color"
                    value={doc.palette[color - 1] ?? '#000000'}
                    onChange={(e) => editor.setColor(color, e.target.value)}
                    aria-label="고른 색 바꾸기"
                  />
                  <button
                    type="button"
                    className="button"
                    disabled={doc.palette.length >= PALETTE_MAX_COLORS}
                    onClick={() => {
                      const added = editor.addColor(doc.palette[color - 1] ?? '#000000');
                      if (added) setColor(added);
                    }}
                  >
                    색 추가
                  </button>
                  <button
                    type="button"
                    className="button"
                    disabled={doc.palette.length <= 1}
                    onClick={() => {
                      if (!window.confirm('이 색을 지울까요? 이 색으로 칠한 곳은 투명해집니다.'))
                        return;
                      editor.removeColor(color);
                      setColor((c) => Math.max(1, Math.min(c, doc.palette.length)));
                    }}
                  >
                    색 지우기
                  </button>
                </div>
                <p className="form__hint">
                  {doc.palette.length}색 (색 수 제한 없음) · 오른쪽 버튼으로 지웁니다
                </p>
              </section>

              {doc.kind === 'tile' && (
                <section>
                  <h3>타일</h3>
                  <label className="pixel-editor__check">
                    <input
                      type="checkbox"
                      checked={doc.solid}
                      onChange={(e) => editor.setSolid(e.target.checked)}
                    />
                    지나갈 수 없음 (벽, 물, 나무 등. 횡스크롤에서는 딛고 서는 땅)
                  </label>
                  <label className="pixel-editor__check">
                    <input
                      type="checkbox"
                      checked={doc.platform}
                      onChange={(e) => editor.setPlatform(e.target.checked)}
                    />
                    발판 (횡스크롤: 위에서만 딛고 아래에서는 뛰어 지나감)
                  </label>
                </section>
              )}

              {doc.kind === 'object' && <ObjectSettings editor={editor} />}

              {doc.kind === 'character' && (
                <CharacterStyleSettings
                  editor={editor}
                  onChange={() => setSelected({ animation: 0, frame: 0 })}
                />
              )}

              {doc.kind === 'character' && (
                <CharacterSizeSettings editor={editor} applyPendingRef={applyPendingSize} />
              )}

              {doc.kind === 'character' && (
                <section>
                  <h3>애니메이터</h3>
                  <p className="form__hint">
                    {doc.animator
                      ? `상태 ${doc.animator.states.length}개 · 전이 ${doc.animator.transitions.length}개. 광장에서 이 그래프대로 애니메이션을 틉니다.`
                      : '없으면 대기·걷기·점프·첨부 모션(있으면)을 정해진 규칙대로 틉니다. 상태 그래프로 언제 무엇을 틀지 직접 정할 수 있습니다 (유니티 Animator처럼).'}
                  </p>
                  <button type="button" className="button" onClick={() => setAnimatorOpen(true)}>
                    <Workflow aria-hidden /> 애니메이터 열기
                  </button>
                </section>
              )}

              {doc.kind === 'character' && (
                <section>
                  <h3>빈 곳 정리</h3>
                  <label className="pixel-editor__check">
                    <input
                      type="checkbox"
                      checked={trimFeet}
                      onChange={(e) => {
                        setTrimFeet(e.target.checked);
                        saveTrim(TRIM_FEET_KEY, e.target.checked);
                      }}
                    />
                    저장할 때 발 아래 빈 줄 자동 정리
                  </label>
                  <label className="pixel-editor__check">
                    <input
                      type="checkbox"
                      checked={trimMargins}
                      onChange={(e) => {
                        setTrimMargins(e.target.checked);
                        saveTrim(TRIM_MARGINS_KEY, e.target.checked);
                      }}
                    />
                    저장할 때 머리 위·양옆 빈 곳 자동 정리
                  </label>
                  <div className="pixel-editor__row">
                    <button
                      type="button"
                      className="button"
                      onClick={() => {
                        const trimmed = editor.trimBelowFeet();
                        const cut = editor.trimMargins();
                        const messages = [
                          ...(trimmed.animations ? [trimMessage(trimmed)] : []),
                          ...(cut.top || cut.sides ? [marginMessage(cut)] : []),
                        ];
                        setStatus({
                          kind: 'ok',
                          text: messages.length ? messages.join(' ') : '정리할 빈 곳이 없습니다.',
                        });
                      }}
                    >
                      지금 정리
                    </button>
                  </div>
                  <p className="form__hint">
                    발 아래: 광장은 그림의 맨 아래를 발밑으로 세웁니다. 애니메이션마다 모든
                    프레임에서 함께 비어 있는 아래 줄만큼 그림을 내려서 떠 보이지 않게 합니다
                    (걷기의 들썩임은 그대로).
                  </p>
                  <p className="form__hint">
                    머리 위·양옆: 모든 프레임에서 함께 비어 있는 위 줄과 양옆 열을 잘라 해상도를
                    줄입니다 (양옆은 가운데가 그대로이게 똑같이, 16px 아래로는 줄이지 않음).
                    광장에서는 세로가 광장 크기만큼 그려지므로 위가 비어 있던 캐릭터는 그만큼 커
                    보입니다.
                  </p>
                </section>
              )}

              <section>
                <h3>애니메이션</h3>
                {doc.kind === 'character' && (
                  <p className="form__hint">
                    {sideCharacter
                      ? '✓·✗ 표시가 있는 것은 모두 그려야 저장할 수 있습니다 (걷기는 2프레임 이상, 점프는 1프레임 이상). 오른쪽만 그리면 왼쪽은 광장에서 좌우 반전됩니다. 첨부 모션은 없어도 됩니다 (없으면 첨부를 보낼 때 제자리에서 뜀).'
                      : '✓·✗ 표시가 있는 것은 모두 그려야 저장할 수 있습니다 (걷기는 2프레임 이상). 첨부 모션은 없어도 됩니다 (없으면 첨부를 보낼 때 제자리에서 뜀).'}
                  </p>
                )}
                <ul className="pixel-editor__animations">
                  {doc.animations.map((a, i) => (
                    <li key={a.name}>
                      <button
                        type="button"
                        aria-current={i === ref.animation}
                        onClick={() => setSelected({ animation: i, frame: 0 })}
                      >
                        {requiredNames.has(a.name) && (
                          <span
                            className={
                              missingNames.has(a.name) ? 'mark mark--todo' : 'mark mark--done'
                            }
                          >
                            {missingNames.has(a.name) ? (
                              <X role="img" aria-label="덜 그림" />
                            ) : (
                              <Check role="img" aria-label="다 그림" />
                            )}
                          </span>
                        )}
                        {a.key !== undefined && (
                          <kbd className="pixel-editor__motion-key" title={`광장에서 ${a.key} 키`}>
                            {a.key}
                          </kbd>
                        )}
                        {animationLabel(a)}
                        {a.loop && (
                          <Repeat2 className="pixel-editor__loop" role="img" aria-label="반복" />
                        )}
                        <small>{a.frames.length}프레임</small>
                      </button>
                    </li>
                  ))}
                </ul>
                {doc.kind === 'character' && (
                  <div className="pixel-editor__row">
                    <button
                      type="button"
                      className="button"
                      disabled={editor.freeMotionKeys().length === 0 || !editor.canAddAnimation()}
                      title="광장에서 키를 눌러 트는 모션 (키는 직접 바꿀 수 있음)"
                      onClick={() => {
                        const at = editor.addMotion();
                        if (at !== null) setSelected({ animation: at, frame: 0 });
                      }}
                    >
                      <Plus aria-hidden /> 모션
                    </button>
                    {!editor.hasEmote() && (
                      <button
                        type="button"
                        className="button"
                        disabled={!editor.canAddAnimation()}
                        title="첨부 메시지를 보냈을 때 광장에서 한 번 트는 애니메이션 (없으면 제자리에서 뜀)"
                        onClick={() => {
                          const at = editor.addEmote();
                          if (at !== null) setSelected({ animation: at, frame: 0 });
                        }}
                      >
                        <Plus aria-hidden /> 첨부 모션
                      </button>
                    )}
                    {!sideCharacter && !editor.hasJump() && (
                      <button
                        type="button"
                        className="button"
                        disabled={!editor.canAddAnimation()}
                        title="횡스크롤 광장에서 공중에 있을 때 (없으면 걷기의 두 번째 프레임)"
                        onClick={() => {
                          const at = editor.addJump();
                          if (at !== null) setSelected({ animation: at, frame: 0 });
                        }}
                      >
                        <Plus aria-hidden /> 점프
                      </button>
                    )}
                  </div>
                )}
                <label className="pixel-editor__row">
                  프레임 간격
                  <input
                    type="number"
                    min={FRAME_MS_MIN}
                    max={FRAME_MS_MAX}
                    step={10}
                    value={animation.frameMs}
                    onChange={(e) => {
                      const ms = Math.round(Number(e.target.value));
                      if (ms >= FRAME_MS_MIN && ms <= FRAME_MS_MAX)
                        editor.setFrameMs(ref.animation, ms);
                    }}
                  />
                  ms
                </label>
              </section>

              {doc.kind === 'character' && isMotion(animation) && (
                <MotionSettings
                  editor={editor}
                  index={ref.animation}
                  animation={animation}
                  onRemove={() => {
                    editor.removeAnimation(ref.animation);
                    setSelected({ animation: 0, frame: 0 });
                  }}
                />
              )}
              {doc.kind === 'character' &&
                !isMotion(animation) &&
                !requiredNames.has(animation.name) && (
                  <section>
                    <h3>{animationLabel(animation)}</h3>
                    <p className="form__hint">{leftoverHint(animation.name, sideCharacter)}</p>
                    <button
                      type="button"
                      className="button button--danger"
                      onClick={() => {
                        editor.removeAnimation(ref.animation);
                        setSelected({ animation: 0, frame: 0 });
                      }}
                    >
                      이 애니메이션 지우기
                    </button>
                  </section>
                )}

              <section>
                <h3>미리보기</h3>
                <Playback editor={editor} animation={ref.animation} />
              </section>
            </aside>
          </div>

          <footer className="pixel-editor__frames" aria-label="프레임">
            <ol>
              {animation.frames.map((frame, i) => (
                <li key={i}>
                  <button
                    type="button"
                    aria-current={i === ref.frame}
                    onClick={() => selectFrame(i)}
                    title={`${i + 1}번 프레임`}
                  >
                    <FrameThumb
                      pixels={frame}
                      doc={doc}
                      revision={i === ref.frame ? editor.version : 0}
                    />
                    <span>{i + 1}</span>
                  </button>
                </li>
              ))}
            </ol>
            <div className="pixel-editor__frame-actions">
              <div className="pixel-editor__frame-nav" role="group" aria-label="프레임 넘기기">
                <button
                  type="button"
                  className="button"
                  disabled={animation.frames.length <= 1}
                  onClick={() => stepFrame(-1)}
                  aria-label="앞 프레임"
                  title="앞 프레임 (←)"
                >
                  <ChevronLeft aria-hidden />
                </button>
                <span className="pixel-editor__frame-count" aria-live="polite">
                  {ref.frame + 1} / {animation.frames.length}
                </span>
                <button
                  type="button"
                  className="button"
                  disabled={animation.frames.length <= 1}
                  onClick={() => stepFrame(1)}
                  aria-label="다음 프레임"
                  title="다음 프레임 (→)"
                >
                  <ChevronRight aria-hidden />
                </button>
              </div>
              <button
                type="button"
                className="button"
                disabled={frameCount >= FRAME_LIMIT[doc.kind]}
                onClick={() => {
                  const at = editor.addFrame(ref, false);
                  if (at !== null) selectFrame(at);
                }}
              >
                빈 프레임
              </button>
              <button
                type="button"
                className="button"
                disabled={frameCount >= FRAME_LIMIT[doc.kind]}
                onClick={() => {
                  const at = editor.addFrame(ref, true);
                  if (at !== null) selectFrame(at);
                }}
              >
                복제
              </button>
              {/* 순서 옮기기: 고른 프레임을 앞·뒤 프레임과 맞바꾼다 (넘기기와 헷갈리지 않게 따로 둔다) */}
              <button
                type="button"
                className="button"
                disabled={ref.frame === 0}
                title="이 프레임을 한 칸 앞으로 옮기기"
                onClick={() => {
                  editor.moveFrame(ref, ref.frame - 1);
                  selectFrame(ref.frame - 1);
                }}
              >
                <ArrowLeftToLine aria-hidden /> 앞으로 옮기기
              </button>
              <button
                type="button"
                className="button"
                disabled={ref.frame >= animation.frames.length - 1}
                title="이 프레임을 한 칸 뒤로 옮기기"
                onClick={() => {
                  editor.moveFrame(ref, ref.frame + 1);
                  selectFrame(ref.frame + 1);
                }}
              >
                뒤로 옮기기 <ArrowRightToLine aria-hidden />
              </button>
              <button
                type="button"
                className="button button--danger"
                disabled={animation.frames.length <= 1}
                onClick={() => editor.removeFrame(ref)}
              >
                프레임 지우기
              </button>
              <span className="form__hint">
                {frameCount}/{FRAME_LIMIT[doc.kind]}장 (같은 그림은 한 장)
              </span>
            </div>
          </footer>
        </>
      )}
      {importing && (
        <GifImportDialog
          editor={editor}
          files={importing.files}
          source={importing.source}
          forAnimator={!!importing.forAnimator}
          current={ref.animation}
          onClose={() => setImporting(null)}
          onDone={(first, message) => {
            const before = importing.forAnimator;
            setImporting(null);
            if (first !== null) setSelected({ animation: first, frame: 0 });
            setStatus({ kind: 'ok', text: message });
            // 애니메이터에서 연 것이면 새로 생긴 애니메이션마다 그것을 트는 상태를 더한다.
            const animator = editor.doc.animator;
            if (before && animator) {
              const added = editor.doc.animations
                .map((a) => a.name)
                .filter((name) => !before.has(name));
              if (added.length > 0) editor.setAnimator(withStatesFor(animator, added));
            }
          }}
        />
      )}
    </div>
  );
}

/** 팔레트 칸을 처음에 보여 줄 수 (색이 아주 많으면 나머지는 "더 보기"로 펼친다) */
const SWATCH_PAGE = 256;

/**
 * 팔레트 칸들. 색 수 제한이 없어 GIF·PNG를 가져오면 색이 수천 개일 수 있으므로, 그림판 위에서 마우스를
 * 움직일 때마다(에디터가 다시 그려질 때마다) 칸을 모두 다시 그리지 않게 팔레트가 바뀔 때만 그리고,
 * 처음엔 SWATCH_PAGE개만 보인다.
 */
const PaletteSwatches = memo(function PaletteSwatches({
  palette,
  selected,
  onPick,
}: {
  palette: readonly string[];
  /** 팔레트를 그 자리에서 고치므로 바뀐 것은 문서 버전으로 안다 */
  version: number;
  /** 고른 픽셀 값 (지우개면 0) */
  selected: number;
  onPick(value: number): void;
}) {
  const [shown, setShown] = useState(SWATCH_PAGE);
  const visible = palette.slice(0, shown);
  return (
    <>
      <div className="pixel-editor__palette">
        {visible.map((hex, i) => (
          <button
            key={i}
            type="button"
            className="pixel-editor__swatch"
            style={{ background: hex }}
            aria-pressed={selected === i + 1}
            title={hex}
            onClick={() => onPick(i + 1)}
          />
        ))}
      </div>
      {palette.length > shown && (
        <button
          type="button"
          className="button pixel-editor__more-colors"
          onClick={() => setShown((n) => n + SWATCH_PAGE * 4)}
        >
          색 {palette.length - shown}개 더 보기
        </button>
      )}
    </>
  );
});

/** 캐릭터 모션 설정: 이름, 키, 반복, 지우기 */
function MotionSettings({
  editor,
  index,
  animation,
  onRemove,
}: {
  editor: PixelDocument;
  index: number;
  animation: EditorAnimation;
  onRemove(): void;
}) {
  return (
    <section>
      <h3>모션</h3>
      <label className="pixel-editor__field">
        이름
        <input
          value={animation.label ?? ''}
          maxLength={MOTION_LABEL_MAX_LENGTH}
          placeholder={animation.name}
          onChange={(e) => editor.updateMotion(index, { label: e.target.value })}
        />
      </label>
      <div className="pixel-editor__row">
        키
        <KeyCapture
          value={animation.key}
          allowNone={false}
          taken={(key) => editor.keyTaken(key, animation.key)}
          onChange={(key) => key && editor.updateMotion(index, { key })}
          aria-label="광장에서 누를 키"
        />
      </div>
      <label className="pixel-editor__check">
        <input
          type="checkbox"
          checked={!!animation.loop}
          onChange={(e) => editor.updateMotion(index, { loop: e.target.checked })}
        />
        움직일 때까지 반복 (끄면 한 번)
      </label>
      <p className="form__hint">
        광장에서 이 키를 누르면 틉니다. 키 칸을 누른 뒤 원하는 키를 누르면 바뀝니다. 반복하는 모션은
        다시 누르거나 움직이면 멈춥니다.
      </p>
      <button type="button" className="button button--danger" onClick={onRemove}>
        이 모션 지우기
      </button>
    </section>
  );
}

/** 필수가 아닌 애니메이션(첨부 모션, 점프, 남겨 둔 왼쪽·위·아래, 애니메이터용)의 설명 */
function leftoverHint(name: string, side: boolean): string {
  if (name === 'emote') {
    return '첨부 메시지를 보냈을 때 광장에서 한 번 틉니다. 지우면 첨부를 보낼 때 제자리에서 뛰기만 합니다.';
  }
  if (!STANDARD_ANIMATIONS.has(name)) {
    return '애니메이터의 상태가 트는 애니메이션입니다. 지우면 이것을 가리키던 상태가 빨간 점선으로 보이고 저장이 막힙니다.';
  }
  if (side && name.endsWith('-left')) {
    return '왼쪽 모습을 따로 그린 것입니다. 지우면 오른쪽을 좌우 반전해서 씁니다 (좌우가 다른 캐릭터만 남겨 두세요).';
  }
  if (side) {
    return '횡스크롤용 캐릭터는 쓰지 않는 애니메이션입니다 (탑다운으로 되돌릴 때를 위해 남겨 두었습니다).';
  }
  return '횡스크롤 광장에서 뛰어오르거나 떨어질 때 한 번 틉니다. 지우면 걷기의 두 번째 프레임을 씁니다.';
}

const STYLE_OPTION: Record<PlazaStyle, { label: string; hint: string }> = {
  [PlazaStyle.TopDown]: {
    label: '탑다운',
    hint: '위에서 내려다보는 광장용. 대기·걷기 4방향(아래·왼쪽·오른쪽·위)을 그립니다 (첨부 모션은 골라서). 횡스크롤 광장에서도 쓸 수 있습니다.',
  },
  [PlazaStyle.SideScroll]: {
    label: '횡스크롤',
    hint: '옆에서 보는 광장용. 오른쪽을 보는 대기·걷기·점프를 그립니다 (첨부 모션은 골라서). 왼쪽은 오른쪽을 좌우 반전해서 쓰고, 위·아래 모습이 없어서 탑다운 광장에서는 쓸 수 없습니다.',
  },
};

/**
 * 캐릭터가 쓰는 광장 방식. 고르면 필수 애니메이션이 바뀐다 (없는 것은 더하고, 쓰지 않게 된 것은 남겨 둠).
 */
function CharacterStyleSettings({ editor, onChange }: { editor: PixelDocument; onChange(): void }) {
  const { style } = editor.doc;
  return (
    <section>
      <h3>광장 방식</h3>
      <div className="pixel-editor__segmented" role="radiogroup" aria-label="광장 방식">
        {PLAZA_STYLES.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={style === s}
            onClick={() => {
              editor.setStyle(s);
              onChange();
            }}
          >
            {STYLE_OPTION[s].label}
          </button>
        ))}
      </div>
      <p className="form__hint">{STYLE_OPTION[style].hint}</p>
    </section>
  );
}

/**
 * 캐릭터 해상도 (가로·세로 각각 16~512px). 광장에서는 세로가 늘 2타일이고 가로는 그림 비율대로라,
 * 해상도를 올리면 같은 자리에 더 촘촘하게 그려진다. 받아 온 에셋을 줄이지 않고 쓰려고 열어 둔 설정이다.
 */
function CharacterSizeSettings({
  editor,
  applyPendingRef,
}: {
  editor: PixelDocument;
  /** 저장할 때 아직 적용하지 않은 입력을 적용하도록 apply를 넘겨 둔다 */
  applyPendingRef: RefObject<(() => void) | null>;
}) {
  const { doc } = editor;
  const [input, setInput] = useState({ width: String(doc.width), height: String(doc.height) });
  // 되돌리기 등으로 크기가 바뀌면 입력칸도 따라간다.
  const [shown, setShown] = useState(`${doc.width}x${doc.height}`);
  if (shown !== `${doc.width}x${doc.height}`) {
    setShown(`${doc.width}x${doc.height}`);
    setInput({ width: String(doc.width), height: String(doc.height) });
  }

  const apply = () => {
    const valid = (v: number) =>
      Number.isInteger(v) && v >= CHARACTER_MIN_SIZE && v <= CHARACTER_MAX_SIZE;
    const width = Number(input.width);
    const height = Number(input.height);
    if (!valid(width) || !valid(height)) {
      setInput({ width: String(doc.width), height: String(doc.height) });
      return;
    }
    editor.resizeCharacter(width, height);
  };
  useEffect(() => {
    applyPendingRef.current = apply;
    return () => {
      applyPendingRef.current = null;
    };
  });
  const pending = input.width !== String(doc.width) || input.height !== String(doc.height);

  const field = (axis: 'width' | 'height', label: string) => (
    <input
      type="number"
      min={CHARACTER_MIN_SIZE}
      max={CHARACTER_MAX_SIZE}
      step={1}
      value={input[axis]}
      aria-label={label}
      onChange={(e) => setInput((v) => ({ ...v, [axis]: e.target.value }))}
      onBlur={apply}
      onKeyDown={(e) => {
        if (e.key === 'Enter') apply();
      }}
    />
  );

  return (
    <section>
      <h3>해상도</h3>
      <div className="pixel-editor__row">
        가로
        {field('width', '캐릭터 가로 픽셀')}× 세로
        {field('height', '캐릭터 세로 픽셀')}
        px
        {pending && (
          <button type="button" className="button" onClick={apply}>
            적용
          </button>
        )}
      </div>
      <p className="form__hint">
        가로·세로 각각 {CHARACTER_MIN_SIZE}~{CHARACTER_MAX_SIZE}px입니다. 광장에서는 아래의 광장
        크기(세로)에 맞춰 그리고 가로는 그림 비율대로라, 해상도를 올리면 같은 자리에 더 촘촘하게
        그려집니다. 크기를 바꾸면 그림은 발밑 가운데를 기준으로 남습니다.
      </p>
      <label className="pixel-editor__row">
        광장 크기
        <Select
          value={String(doc.plazaHeight)}
          options={CHARACTER_PLAZA_HEIGHTS.map((h) => ({
            value: String(h),
            label: `세로 ${h}타일${h === CHARACTER_PLAZA_HEIGHT_DEFAULT ? ' (기본)' : ''}`,
          }))}
          onChange={(h) => editor.setPlazaHeight(Number(h))}
          aria-label="광장에서 캐릭터 세로 크기"
        />
      </label>
      <p className="form__hint">
        광장에서 이 캐릭터를 얼마나 크게 그릴지 정합니다 (그림판의 굵은 가로선이 1타일). 부딪히고
        걷는 범위는 크기와 상관없이 발밑만 봅니다.
      </p>
    </section>
  );
}

interface MenuItem {
  label: string;
  hint: string;
  run(): void;
}

/** 머리글의 펼치는 메뉴 (가져오기, 내보내기). 바깥을 누르면 닫힌다 (Esc는 에디터의 키 처리가 닫음) */
function EditorMenu({
  label,
  open,
  onToggle,
  items,
}: {
  label: string;
  open: boolean;
  onToggle(open: boolean): void;
  items: MenuItem[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onToggle(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open, onToggle]);
  return (
    <div className="pixel-editor__menu-wrap" ref={ref}>
      <button
        type="button"
        className="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onToggle(!open)}
      >
        {label} <ChevronDown aria-hidden />
      </button>
      {open && (
        <div className="menu pixel-editor__menu" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                onToggle(false);
                item.run();
              }}
            >
              <strong>{item.label}</strong>
              <small>{item.hint}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ObjectSettings({ editor }: { editor: PixelDocument }) {
  const { doc } = editor;
  const cols = doc.width / TILE_SIZE;
  const rows = doc.height / TILE_SIZE;
  const sizes = Array.from({ length: OBJECT_MAX_TILES }, (_, i) => i + 1);
  return (
    <section>
      <h3>오브젝트</h3>
      <div className="pixel-editor__row">
        크기
        <Select
          value={String(cols)}
          options={sizes.map((n) => ({ value: String(n), label: `가로 ${n}칸` }))}
          onChange={(n) => editor.resize(Number(n), rows)}
          aria-label="가로 칸"
        />
        <Select
          value={String(rows)}
          options={sizes.map((n) => ({ value: String(n), label: `세로 ${n}칸` }))}
          onChange={(n) => editor.resize(cols, Number(n))}
          aria-label="세로 칸"
        />
      </div>
      <p className="form__hint">
        지나갈 수 없는 칸을 누르세요. 보통 아래 줄(밑동)만 막아야 캐릭터가 뒤로 지나가며 가려집니다.
        오브젝트는 맵에서 그림의 왼쪽 아래 칸에 놓입니다.
      </p>
      <div
        className="pixel-editor__footprint"
        style={{ gridTemplateColumns: `repeat(${cols}, 24px)` }}
      >
        {doc.footprint.map((blocked, i) => (
          <button
            key={i}
            type="button"
            aria-pressed={!!blocked}
            aria-label={`${Math.floor(i / cols) + 1}줄 ${(i % cols) + 1}칸`}
            onClick={() => editor.toggleFootprint(i)}
          />
        ))}
      </div>
    </section>
  );
}

const THUMB_BOX = 40;

/**
 * 프레임 목록의 작은 그림. 큰 캐릭터(512×512)는 캔버스도 작게 만들어 부드럽게 줄여 그리고, 그림이 바뀔 때만
 * 다시 그린다 (프레임마다 원래 크기 캔버스를 매번 그리면 붓질할 때 느려졌다). 고른 프레임은 붓질하는 동안
 * 같은 배열을 그 자리에서 고치므로 revision(문서 버전)도 본다.
 */
function FrameThumb({
  pixels,
  doc,
  revision,
}: {
  pixels: Uint16Array;
  doc: EditorDoc;
  revision: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const longest = Math.max(doc.width, doc.height);
  const shown = THUMB_BOX / longest;
  // 작은 그림은 도트 그대로 정수배, 큰 그림은 보이는 크기로 줄인 캔버스
  const scale = longest > THUMB_BOX ? shown : Math.max(1, Math.floor(THUMB_BOX / longest));
  const width = Math.max(1, Math.round(doc.width * scale));
  const height = Math.max(1, Math.round(doc.height * scale));
  const palette = doc.palette.join();
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = scale < 1;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(
      frameCanvas(pixels, doc.width, doc.height, palette.split(',')),
      0,
      0,
      canvas.width,
      canvas.height,
    );
  }, [pixels, doc.width, doc.height, palette, revision, scale]);
  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      style={{ width: doc.width * shown, height: doc.height * shown }}
    />
  );
}

/** 미리보기가 차지할 크기 (가장 긴 변, px) */
const PLAYBACK_BOX = 96;

/** 고른 애니메이션을 재생한다 (그리는 중에도 바로 반영). 해상도와 상관없이 늘 같은 크기로 보인다 */
function Playback({ editor, animation }: { editor: PixelDocument; animation: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { width, height } = editor.doc;
  const longest = Math.max(width, height);
  const scale = useMemo(() => Math.max(1, Math.floor(PLAYBACK_BOX / longest)), [longest]);
  const shown = PLAYBACK_BOX / longest;
  useEffect(() => {
    let raf = 0;
    let shown = '';
    const start = performance.now();
    const tick = (now: number) => {
      // 그리다가 예외가 나도 재생이 멈추지 않게 다음 프레임을 먼저 건다.
      raf = requestAnimationFrame(tick);
      const canvas = ref.current;
      const current = editor.doc.animations[animation];
      // rAF의 now는 그 프레임이 시작한 시각이라, 화면이 바쁠 때(에디터를 막 열었을 때 등) start보다 이를 수
      // 있다. 음수면 프레임 번호가 -1이 되어 없는 프레임을 그리다 예외로 재생이 멈췄고, 미리보기가 비었다.
      const index = current
        ? Math.floor(Math.max(0, now - start) / current.frameMs) %
          Math.max(1, current.frames.length)
        : 0;
      const pixels = current?.frames[index];
      if (!canvas || !pixels) return;
      // 프레임이나 그림, 캔버스 크기(해상도를 바꾸면 캔버스가 지워짐)가 바뀔 때만 다시 그린다.
      const key = `${index}:${editor.version}:${canvas.width}x${canvas.height}`;
      if (key !== shown) {
        shown = key;
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(
          frameCanvas(pixels, editor.doc.width, editor.doc.height, editor.doc.palette),
          0,
          0,
          canvas.width,
          canvas.height,
        );
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [editor, animation]);
  return (
    <canvas
      ref={ref}
      className="pixel-editor__playback"
      width={width * scale}
      height={height * scale}
      style={{ width: width * shown, height: height * shown }}
    />
  );
}
