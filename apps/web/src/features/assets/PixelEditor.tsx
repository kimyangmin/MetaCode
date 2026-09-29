import {
  ASSET_NAME_MAX_LENGTH,
  CHARACTER_MAX_WIDTH,
  CHARACTER_MIN_WIDTH,
  FRAME_LIMIT,
  FRAME_MS_MAX,
  FRAME_MS_MIN,
  OBJECT_MAX_TILES,
  PALETTE_MAX_COLORS,
  REQUIRED_CHARACTER_ANIMATIONS,
  TILE_SIZE,
  assetManifestSchema,
  characterHeightOf,
  missingAnimations,
} from '@metacode/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ApiError } from '../../api/client';
import { saveAsset } from './api';
import {
  type EditorDoc,
  type FrameRef,
  PixelDocument,
  fromManifest,
  toManifest,
} from './editorModel';
import type { EditorTarget } from './editorStore';
import { downloadCanvas, indexImage, readImageFile } from './png';
import {
  type Clip,
  type Point,
  type Rect,
  clearMasked,
  copyClip,
  isEmptyMask,
  lassoMask,
  maskOutline,
  maskedValues,
  placeClip,
  rectFrom,
  shiftPixels,
  stamp,
} from './selection';
import {
  Check,
  Eraser,
  FlipHorizontal2,
  Ghost,
  Lasso,
  PaintBucket,
  Pencil,
  Pipette,
  Redo2,
  Scissors,
  Undo2,
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
  lifted: { base: Uint8Array; values: Uint8Array } | null;
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
      base: Uint8Array;
      values: Uint8Array;
    }
  | { kind: 'crop'; start: Point };

const TRIM_FEET_KEY = 'metacode:editor-trim-feet';

function trimMessage(trimmed: { animations: number; rows: number }): string {
  return `애니메이션 ${trimmed.animations}개의 발 아래 빈 줄을 정리했습니다 (최대 ${trimmed.rows}줄).`;
}

function readTrimFeet(): boolean {
  try {
    return localStorage.getItem(TRIM_FEET_KEY) !== 'off';
  } catch {
    return true;
  }
}

function saveTrimFeet(on: boolean) {
  try {
    localStorage.setItem(TRIM_FEET_KEY, on ? 'on' : 'off');
  } catch {
    // 기억하지 못해도 이번 편집에는 적용된다.
  }
}

const KIND_LABEL = { tile: '타일', object: '오브젝트', character: '캐릭터' } as const;

const ANIMATION_LABEL = new Map(REQUIRED_CHARACTER_ANIMATIONS.map((a) => [a.name, a.label]));

function rgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

/** 팔레트 픽셀 한 장을 원래 크기 캔버스로 */
function frameCanvas(pixels: Uint8Array, width: number, height: number, palette: string[]) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const image = new ImageData(width, height);
  const colors = palette.map(rgb);
  pixels.forEach((v, i) => {
    const c = v > 0 ? colors[v - 1] : undefined;
    if (!c) return;
    image.data.set([c[0], c[1], c[2], 255], i * 4);
  });
  canvas.getContext('2d')!.putImageData(image, 0, 0);
  return canvas;
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
  const [color, setColor] = useState(1);
  const [mirror, setMirror] = useState(false);
  const [onion, setOnion] = useState(false);
  const [zoom, setZoom] = useState(() =>
    Math.max(2, Math.min(28, Math.floor(480 / Math.max(doc.width, doc.height)))),
  );
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [lassoPath, setLassoPath] = useState<Point[] | null>(null);
  const [crop, setCrop] = useState<{ rect: Rect; width: number; height: number } | null>(null);
  const [cropFit, setCropFit] = useState(false);
  const [clipboard, setClipboard] = useState<Clip | null>(null);
  const [trimFeet, setTrimFeet] = useState(readTrimFeet);
  const fileRef = useRef<HTMLInputElement>(null);

  // 되돌리기 등으로 애니메이션·프레임 수가 바뀌어도 고른 프레임이 범위 안에 있게 한다.
  const animation = doc.animations[Math.min(selected.animation, doc.animations.length - 1)]!;
  const ref: FrameRef = {
    animation: Math.min(selected.animation, doc.animations.length - 1),
    frame: Math.min(selected.frame, animation.frames.length - 1),
  };
  const pixels = animation.frames[ref.frame]!;
  const manifest = toManifest(doc);
  const missing = doc.kind === 'character' ? missingAnimations(manifest) : [];
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

  const requestClose = useCallback(() => {
    if (editor.dirty && !window.confirm('저장하지 않은 변경이 있습니다. 닫을까요?')) return;
    onClose();
  }, [editor, onClose]);

  // ── 선택 영역 ──

  /** 떠 있는 선택을 (dx, dy)만큼 옮긴 결과로 프레임을 다시 만든다 */
  const floatTo = (
    from: { mask: Uint8Array; base: Uint8Array; values: Uint8Array },
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
    const base = Uint8Array.from(pixels);
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

  // ── 키보드 ── (매번 새로 걸어 지금 선택 상태를 쓴다)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
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
      if (target.closest('input, textarea, select')) return;
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
        if (found) setTool(found.id);
        else if (key === 'm') setMirror((v) => !v);
        else if (key === 'o') setOnion((v) => !v);
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
        } else if (e.key === 'ArrowLeft')
          setSelected((s) => ({ ...s, frame: Math.max(0, s.frame - 1) }));
        else if (e.key === 'ArrowRight') setSelected((s) => ({ ...s, frame: s.frame + 1 }));
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // ── 그림판 ──
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);

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
    // 늘 1타일×2타일을 차지하므로 가로 전체가 한 칸이고 세로 한가운데에만 선이 있다.
    const step =
      doc.kind === 'character' ? { x: width, y: height / 2 } : { x: TILE_SIZE, y: TILE_SIZE };
    ctx.strokeStyle = 'rgba(128, 128, 128, 0.6)';
    ctx.beginPath();
    for (let x = step.x; x < width; x += step.x) {
      ctx.moveTo(x * zoom + 0.5, 0);
      ctx.lineTo(x * zoom + 0.5, canvas.height);
    }
    for (let y = step.y; y < height; y += step.y) {
      ctx.moveTo(0, y * zoom + 0.5);
      ctx.lineTo(canvas.width, y * zoom + 0.5);
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
    editor.begin();
    editor.paint(ref, p.x, p.y, value, mirror);
    drag.current = { kind: 'stroke', last: p, value };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const current = drag.current;
    if (!current) return;
    if (current.kind === 'lasso') {
      const p = exactAt(e);
      setLassoPath((path) => (path ? [...path, p] : [p]));
      return;
    }
    const p = pointAt(e);
    if (current.kind === 'stroke') {
      editor.line(ref, current.last, p, current.value, mirror);
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
    const trimmed = doc.kind === 'character' && trimFeet ? editor.trimBelowFeet() : null;
    const result = assetManifestSchema.safeParse(toManifest(editor.doc));
    if (!result.success) {
      setStatus({ kind: 'error', text: result.error.issues.map((i) => i.message).join(' ') });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const asset = await saveAsset(queryClient, { id: savedId, communityId }, result.data);
      setSavedId(asset.id);
      editor.markSaved();
      setStatus({
        kind: 'ok',
        text: trimmed?.animations ? `저장했습니다. ${trimMessage(trimmed)}` : '저장했습니다.',
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
      editor.importFrames(ref, result.frames, result.palette);
      setStatus({ kind: 'ok', text: `${result.frames.length}프레임을 가져왔습니다.` });
    } catch {
      setStatus({ kind: 'error', text: '그림을 읽지 못했습니다.' });
    }
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

  const selectFrame = (frame: number) => setSelected({ animation: ref.animation, frame });

  return (
    <div className="pixel-editor" role="dialog" aria-modal="true" aria-label="도트 에디터">
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
          <button type="button" className="button" onClick={() => fileRef.current?.click()}>
            PNG 가져오기
          </button>
          <button type="button" className="button" onClick={onExport}>
            PNG 내보내기
          </button>
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
        </div>
      </header>

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
            title="크게"
            aria-label="크게"
            onClick={() => setZoom((z) => Math.min(40, z + 2))}
          >
            <ZoomIn aria-hidden />
          </button>
          <button
            type="button"
            className="pixel-editor__tool"
            title="작게"
            aria-label="작게"
            onClick={() => setZoom((z) => Math.max(2, z - 2))}
          >
            <ZoomOut aria-hidden />
          </button>
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
              <button type="button" className="button" onClick={() => setCrop(null)} title="Esc">
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
          <div className="pixel-editor__stage">
            <canvas
              ref={canvasRef}
              className="pixel-editor__canvas"
              width={doc.width * zoom}
              height={doc.height * zoom}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onContextMenu={(e) => e.preventDefault()}
            />
          </div>
        </div>

        <aside className="pixel-editor__side">
          <section>
            <h3>팔레트</h3>
            <div className="pixel-editor__palette">
              {doc.palette.map((hex, i) => (
                <button
                  key={i}
                  type="button"
                  className="pixel-editor__swatch"
                  style={{ background: hex }}
                  aria-pressed={color === i + 1 && tool !== 'eraser'}
                  title={hex}
                  onClick={() => {
                    setColor(i + 1);
                    if (tool === 'eraser' || tool === 'picker') setTool('pen');
                  }}
                />
              ))}
            </div>
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
              {doc.palette.length}/{PALETTE_MAX_COLORS}색 · 오른쪽 버튼으로 지웁니다
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
                지나갈 수 없음 (벽, 물, 나무 등)
              </label>
            </section>
          )}

          {doc.kind === 'object' && <ObjectSettings editor={editor} />}

          {doc.kind === 'character' && <CharacterSizeSettings editor={editor} />}

          {doc.kind === 'character' && (
            <section>
              <h3>발 아래 정리</h3>
              <label className="pixel-editor__check">
                <input
                  type="checkbox"
                  checked={trimFeet}
                  onChange={(e) => {
                    setTrimFeet(e.target.checked);
                    saveTrimFeet(e.target.checked);
                  }}
                />
                저장할 때 발 아래 빈 줄 자동 정리
              </label>
              <div className="pixel-editor__row">
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    const trimmed = editor.trimBelowFeet();
                    setStatus({
                      kind: 'ok',
                      text: trimmed.animations
                        ? trimMessage(trimmed)
                        : '발 아래에 정리할 빈 줄이 없습니다.',
                    });
                  }}
                >
                  지금 정리
                </button>
              </div>
              <p className="form__hint">
                광장은 그림의 맨 아래를 발밑으로 세웁니다. 애니메이션마다 모든 프레임에서 함께 비어
                있는 아래 줄만큼 그림을 내려서 캐릭터가 떠 보이지 않게 합니다 (걷기의 들썩임은
                그대로).
              </p>
            </section>
          )}

          <section>
            <h3>애니메이션</h3>
            {doc.kind === 'character' && (
              <p className="form__hint">
                모두 그려야 저장할 수 있습니다 (걷기·첨부 모션은 2프레임 이상).
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
                    {doc.kind === 'character' && (
                      <span
                        className={missingNames.has(a.name) ? 'mark mark--todo' : 'mark mark--done'}
                      >
                        {missingNames.has(a.name) ? (
                          <X role="img" aria-label="덜 그림" />
                        ) : (
                          <Check role="img" aria-label="다 그림" />
                        )}
                      </span>
                    )}
                    {ANIMATION_LABEL.get(a.name) ?? (a.name === 'default' ? '기본' : a.name)}
                    <small>{a.frames.length}프레임</small>
                  </button>
                </li>
              ))}
            </ul>
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
                <FrameThumb pixels={frame} doc={doc} />
                <span>{i + 1}</span>
              </button>
            </li>
          ))}
        </ol>
        <div className="pixel-editor__frame-actions">
          <button
            type="button"
            className="button"
            disabled={editor.frameCount() >= FRAME_LIMIT[doc.kind]}
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
            disabled={editor.frameCount() >= FRAME_LIMIT[doc.kind]}
            onClick={() => {
              const at = editor.addFrame(ref, true);
              if (at !== null) selectFrame(at);
            }}
          >
            복제
          </button>
          <button
            type="button"
            className="button"
            disabled={ref.frame === 0}
            onClick={() => {
              editor.moveFrame(ref, ref.frame - 1);
              selectFrame(ref.frame - 1);
            }}
          >
            ◀
          </button>
          <button
            type="button"
            className="button"
            disabled={ref.frame >= animation.frames.length - 1}
            onClick={() => {
              editor.moveFrame(ref, ref.frame + 1);
              selectFrame(ref.frame + 1);
            }}
          >
            ▶
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
            {editor.frameCount()}/{FRAME_LIMIT[doc.kind]}장 (같은 그림은 한 장)
          </span>
        </div>
      </footer>
    </div>
  );
}

/**
 * 캐릭터 해상도. 광장에서 차지하는 크기는 늘 1타일×2타일이고, 여기서 고르는 것은 그림의 촘촘함뿐이다.
 * 받아 온 에셋을 줄이지 않고 쓰려고 열어 둔 설정이다.
 */
function CharacterSizeSettings({ editor }: { editor: PixelDocument }) {
  const { doc } = editor;
  const [input, setInput] = useState(String(doc.width));
  // 되돌리기 등으로 크기가 바뀌면 입력칸도 따라간다.
  const [shown, setShown] = useState(doc.width);
  if (shown !== doc.width) {
    setShown(doc.width);
    setInput(String(doc.width));
  }

  const apply = () => {
    const width = Number(input);
    if (!Number.isInteger(width) || width < CHARACTER_MIN_WIDTH || width > CHARACTER_MAX_WIDTH) {
      setInput(String(doc.width));
      return;
    }
    editor.resizeCharacter(width);
  };

  return (
    <section>
      <h3>해상도</h3>
      <div className="pixel-editor__row">
        가로
        <input
          type="number"
          min={CHARACTER_MIN_WIDTH}
          max={CHARACTER_MAX_WIDTH}
          step={1}
          value={input}
          aria-label="캐릭터 가로 픽셀"
          onChange={(e) => setInput(e.target.value)}
          onBlur={apply}
          onKeyDown={(e) => {
            if (e.key === 'Enter') apply();
          }}
        />
        <span>× 세로 {characterHeightOf(Number(input) || doc.width)}px</span>
      </div>
      <p className="form__hint">
        {CHARACTER_MIN_WIDTH}~{CHARACTER_MAX_WIDTH}px, 세로는 가로의 2배입니다. 광장에서 차지하는
        크기는 해상도와 상관없이 늘 1타일×2타일이라, 해상도를 올리면 같은 자리에 더 촘촘하게
        그려집니다. 크기를 바꾸면 그림은 발밑 가운데를 기준으로 남습니다.
      </p>
    </section>
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
        <select
          value={cols}
          onChange={(e) => editor.resize(Number(e.target.value), rows)}
          aria-label="가로 칸"
        >
          {sizes.map((n) => (
            <option key={n} value={n}>
              가로 {n}칸
            </option>
          ))}
        </select>
        <select
          value={rows}
          onChange={(e) => editor.resize(cols, Number(e.target.value))}
          aria-label="세로 칸"
        >
          {sizes.map((n) => (
            <option key={n} value={n}>
              세로 {n}칸
            </option>
          ))}
        </select>
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

function FrameThumb({ pixels, doc }: { pixels: Uint8Array; doc: EditorDoc }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const longest = Math.max(doc.width, doc.height);
  const scale = Math.max(1, Math.floor(THUMB_BOX / longest));
  // 해상도가 높은 캐릭터도 목록에서는 같은 크기로 보이게 CSS로 맞춘다 (캔버스는 도트 그대로).
  const shown = THUMB_BOX / longest;
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(
      frameCanvas(pixels, doc.width, doc.height, doc.palette),
      0,
      0,
      canvas.width,
      canvas.height,
    );
  });
  return (
    <canvas
      ref={ref}
      width={doc.width * scale}
      height={doc.height * scale}
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
      const canvas = ref.current;
      const current = editor.doc.animations[animation];
      const index = current
        ? Math.floor((now - start) / current.frameMs) % Math.max(1, current.frames.length)
        : 0;
      // 프레임이나 그림이 바뀔 때만 다시 그린다.
      const key = `${index}:${editor.version}`;
      if (canvas && current && current.frames.length > 0 && key !== shown) {
        shown = key;
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(
          frameCanvas(
            current.frames[index]!,
            editor.doc.width,
            editor.doc.height,
            editor.doc.palette,
          ),
          0,
          0,
          canvas.width,
          canvas.height,
        );
      }
      raf = requestAnimationFrame(tick);
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
