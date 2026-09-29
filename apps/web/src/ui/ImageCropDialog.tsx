import type { ImageCrop } from '@metacode/shared';
import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import {
  type CropView,
  INITIAL_VIEW,
  MAX_ZOOM,
  MIN_ZOOM,
  type Size,
  cropOf,
  imagePlacement,
  panView,
  zoomView,
} from './imageCrop';

/** 위치를 고를 사진: 파일과 미리 보기 주소. 주소는 여는 쪽이 만들고 닫을 때 지운다 (cropSource) */
export interface CropSource {
  file: File;
  url: string;
}

/** 고른 파일로 위치 조정을 시작한다. 끝나면 releaseCropSource로 주소를 지운다 */
export const cropSource = (file: File): CropSource => ({ file, url: URL.createObjectURL(file) });
export const releaseCropSource = (source: CropSource | null) => {
  if (source) URL.revokeObjectURL(source.url);
};

interface ImageCropDialogProps {
  source: CropSource;
  title: string;
  /** 결과 모양의 가로/세로 (정사각형 1, 배너 16/9) */
  aspect: number;
  /** 결과가 보이는 모양: 원(프로필 사진), 둥근 네모(커뮤니티 아이콘), 네모(배너) */
  shape: 'circle' | 'rounded' | 'rect';
  onCancel(): void;
  /** crop이 없으면 사진을 읽지 못한 것이다 (서버가 가운데를 자른다) */
  onApply(crop: ImageCrop | undefined): void;
}

/** 틀 밖으로 어둡게 보여 주는 여백 */
const MARGIN = 28;
/** 틀의 가장 긴 변 (좁은 화면에서는 줄인다) */
const FRAME_MAX = 320;

/**
 * 올릴 사진의 위치 조정: 사진을 끌어 옮기고, 휠·두 손가락·막대로 확대해 틀 안에 보일 곳을 고른다.
 * 방향키로도 옮길 수 있다. Esc나 바깥을 누르면 취소한다 (아래 창은 닫지 않는다).
 */
export function ImageCropDialog({
  source,
  title,
  aspect,
  shape,
  onCancel,
  onApply,
}: ImageCropDialogProps) {
  const [image, setImage] = useState<Size | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<CropView>(INITIAL_VIEW);

  // 틀 크기: 창이 좁으면 줄인다.
  const bodyRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(FRAME_MAX + MARGIN * 2);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const update = () => setAvailable(body.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(body);
    return () => observer.disconnect();
  }, []);
  const longest = Math.max(120, Math.min(FRAME_MAX, available - MARGIN * 2));
  const frame: Size =
    aspect >= 1
      ? { width: longest, height: Math.round(longest / aspect) }
      : { width: Math.round(longest * aspect), height: longest };

  // Esc는 캡처 단계에서 먼저 받아, 아래에 깔린 설정 창이 닫히지 않게 한다.
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onCancelRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // 끌기와 두 손가락 확대: 누르고 있는 손가락(포인터)들의 마지막 위치
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const distance = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!image) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) pinch.current = { distance: distance(), zoom: view.zoom };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const last = pointers.current.get(e.pointerId);
    if (!last || !image) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const start = pinch.current;
      setView((v) => zoomView(v, image, frame, (start.zoom * distance()) / start.distance));
      return;
    }
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    setView((v) => panView(v, image, frame, dx, dy));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (!image) return;
    setView((v) => zoomView(v, image, frame, v.zoom * Math.exp(-e.deltaY * 0.0015)));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!image) return;
    const step = 8;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      setView((v) => panView(v, image, frame, move[0], move[1]));
    } else if (e.key === '+' || e.key === '=') {
      setView((v) => zoomView(v, image, frame, v.zoom * 1.1));
    } else if (e.key === '-') {
      setView((v) => zoomView(v, image, frame, v.zoom / 1.1));
    }
  };

  const placement = image && imagePlacement(view, image, frame);

  return (
    <div
      className="confirm__overlay"
      onMouseDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="confirm image-crop" role="dialog" aria-modal="true" aria-label={title}>
        <h2 className="confirm__title">{title}</h2>
        <div ref={bodyRef} className="image-crop__body">
          <div
            className="image-crop__stage"
            data-shape={shape}
            style={{ width: frame.width + MARGIN * 2, height: frame.height + MARGIN * 2 }}
            tabIndex={0}
            role="application"
            aria-label="사진을 끌어 보일 곳을 고르세요. 방향키로 옮기고 +, -로 확대합니다."
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
            onKeyDown={onKeyDown}
          >
            <img
              src={source.url}
              alt=""
              draggable={false}
              onLoad={(e) =>
                setImage({
                  width: e.currentTarget.naturalWidth,
                  height: e.currentTarget.naturalHeight,
                })
              }
              onError={() => setFailed(true)}
              style={
                placement
                  ? {
                      left: MARGIN + placement.left,
                      top: MARGIN + placement.top,
                      width: placement.width,
                      height: placement.height,
                    }
                  : { visibility: 'hidden' }
              }
            />
            <div
              className="image-crop__frame"
              style={{ left: MARGIN, top: MARGIN, width: frame.width, height: frame.height }}
            />
            {failed && (
              <p className="image-crop__failed">
                이 브라우저에서 사진을 미리 볼 수 없습니다. 올리면 가운데를 잘라 씁니다.
              </p>
            )}
          </div>
          <label className="image-crop__zoom">
            <ZoomOut aria-hidden />
            <input
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.01}
              value={view.zoom}
              disabled={!image}
              aria-label="확대"
              style={
                {
                  '--fill': `${((view.zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)) * 100}%`,
                } as CSSProperties
              }
              onChange={(e) => {
                const zoom = Number(e.target.value);
                if (image) setView((v) => zoomView(v, image, frame, zoom));
              }}
            />
            <ZoomIn aria-hidden />
          </label>
          <p className="form__hint">사진을 끌어 옮기고, 휠이나 두 손가락으로 확대합니다.</p>
        </div>
        <div className="confirm__actions">
          <button type="button" className="button" onClick={onCancel}>
            취소
          </button>
          <button
            type="button"
            className="button button--primary"
            disabled={!image && !failed}
            onClick={() => onApply(image ? cropOf(view, image, frame) : undefined)}
          >
            적용
          </button>
        </div>
      </div>
    </div>
  );
}
