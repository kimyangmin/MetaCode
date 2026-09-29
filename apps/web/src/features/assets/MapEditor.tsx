import {
  type AssetManifest,
  type AssetRef,
  type CommunityMapDto,
  DEFAULT_ANIMATION,
  MAP_MAX_SIZE,
  MAP_MIN_SIZE,
  TILE_SIZE,
  buildCollision,
  hasStandableSpawn,
  mapDefinitionSchema,
} from '@metacode/shared';
import { BUILTIN_ASSETS } from '@metacode/shared/builtin-assets';
import { useQuery } from '@tanstack/react-query';
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ApiError, apiFetch } from '../../api/client';
import { jsonBody } from '../../api/queries';
import { AssetPreview } from './AssetPreview';
import { useCommunityAssets } from './api';
import { MapDocument, type TileLayer, fromDefinition, tileSize, toDefinition } from './mapModel';
import { framePixels } from './render';
import {
  Brush,
  Eraser,
  Flag,
  Flower2,
  Grid2x2X,
  PaintBucket,
  Redo2,
  Star,
  TreePine,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

type Tool = 'ground' | 'overlay' | 'fill' | 'object' | 'erase' | 'spawn';

/** 팔레트 미리보기 크기 (가장 긴 변, px) */
const PALETTE_BOX = 32;

const TOOLS: { id: Tool; label: string; icon: ReactNode }[] = [
  { id: 'ground', label: '바닥 칠하기', icon: <Brush aria-hidden /> },
  { id: 'overlay', label: '장식 칠하기 (바닥 위에 겹침)', icon: <Flower2 aria-hidden /> },
  { id: 'fill', label: '바닥 채우기', icon: <PaintBucket aria-hidden /> },
  { id: 'object', label: '오브젝트 놓기', icon: <TreePine aria-hidden /> },
  { id: 'erase', label: '지우기 (오브젝트, 장식)', icon: <Eraser aria-hidden /> },
  { id: 'spawn', label: '스폰 영역 (끌어서)', icon: <Flag aria-hidden /> },
];

interface Entry {
  ref: AssetRef;
  manifest: AssetManifest;
  community: boolean;
}

const firstFrames = new WeakMap<AssetManifest, HTMLCanvasElement>();

/** 에셋 첫 프레임을 원래 크기 캔버스로 (맵 그리기용, 매니페스트마다 한 번 만든다) */
function firstFrame(manifest: AssetManifest): HTMLCanvasElement {
  const cached = firstFrames.get(manifest);
  if (cached) return cached;
  const frame = manifest.animations[DEFAULT_ANIMATION]?.frames[0] ?? 0;
  const canvas = document.createElement('canvas');
  canvas.width = manifest.width;
  canvas.height = manifest.height;
  canvas
    .getContext('2d')!
    .putImageData(
      new ImageData(framePixels(manifest, frame), manifest.width, manifest.height),
      0,
      0,
    );
  firstFrames.set(manifest, canvas);
  return canvas;
}

/**
 * 맵 에디터: 커뮤니티 분수 광장의 타일(바닥·장식)을 칠하고 오브젝트를 놓는다.
 * 저장하면 광장을 보던 사람들의 화면이 새 맵으로 바뀌고 모두 스폰 영역에서 다시 시작한다.
 */
export function MapEditor({
  communityId,
  communityName,
  onClose,
}: {
  communityId: string;
  communityName: string;
  onClose(): void;
}) {
  const path = `/communities/${communityId}/map`;
  // 다른 관리자가 고쳤을 수 있으니 열 때마다 새로 받는다 (예전에 받아 둔 맵으로 시작해 덮어쓰지 않게).
  const loaded = useQuery({
    queryKey: ['community-map', communityId],
    queryFn: () => apiFetch<CommunityMapDto>(path),
    staleTime: 0,
    gcTime: 0,
  });
  const communityAssets = useCommunityAssets(communityId).data;
  if (!loaded.data || !loaded.isFetchedAfterMount || !communityAssets) {
    return (
      <div className="pixel-editor map-editor" role="dialog" aria-label="맵 에디터">
        <p className="map-editor__loading">
          {loaded.isError ? '맵을 불러오지 못했습니다.' : '맵을 불러오는 중…'}
        </p>
      </div>
    );
  }
  return (
    <MapEditorBody
      path={path}
      title={`${communityName} 광장`}
      initial={loaded.data}
      entries={[
        ...Object.entries(BUILTIN_ASSETS)
          .filter(([, m]) => m.kind !== 'character')
          .map(([ref, manifest]) => ({ ref, manifest, community: false })),
        ...communityAssets.map((a) => ({ ref: a.id, manifest: a.manifest, community: true })),
      ]}
      onClose={onClose}
    />
  );
}

function MapEditorBody({
  path,
  title,
  initial,
  entries,
  onClose,
}: {
  path: string;
  title: string;
  initial: CommunityMapDto;
  entries: Entry[];
  onClose(): void;
}) {
  const [, setVersion] = useState(0);
  const [editor] = useState(
    () => new MapDocument(fromDefinition(initial.definition), () => setVersion((v) => v + 1)),
  );
  const [custom, setCustom] = useState(initial.custom);
  const [tool, setTool] = useState<Tool>('ground');
  const [tab, setTab] = useState<'tile' | 'object'>('tile');
  const [tile, setTile] = useState<AssetRef>('builtin:tt-0');
  const [object, setObject] = useState<AssetRef>('builtin:bench');
  const [zoom, setZoom] = useState(2);
  const [showBlocked, setShowBlocked] = useState(true);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [spawnDrag, setSpawnDrag] = useState<{ x: number; y: number } | null>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [size, setSize] = useState({ w: editor.doc.width, h: editor.doc.height });
  const painting = useRef<{ x: number; y: number } | null>(null);

  const manifests = useMemo(() => new Map(entries.map((e) => [e.ref, e.manifest])), [entries]);
  const assetOf = useCallback((ref: AssetRef) => manifests.get(ref), [manifests]);
  const sizeOf = useCallback((ref: AssetRef) => tileSize(manifests.get(ref)), [manifests]);
  const frameOf = (ref: AssetRef) => {
    const manifest = manifests.get(ref);
    return manifest ? firstFrame(manifest) : undefined;
  };

  const doc = editor.doc;
  const definition = toDefinition(doc);
  const layout = buildCollision(definition, assetOf);

  const requestClose = useCallback(() => {
    if (editor.dirty && !window.confirm('저장하지 않은 변경이 있습니다. 닫을까요?')) return;
    onClose();
  }, [editor, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        requestClose();
        return;
      }
      if ((e.target as HTMLElement).closest('input, select, textarea')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) editor.redo();
        else editor.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        editor.redo();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [editor, requestClose]);

  // ── 그리기 ──
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const T = TILE_SIZE * zoom;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#11161d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const layer of ['ground', 'overlay'] as const) {
      doc[layer].forEach((v, i) => {
        if (!v) return;
        const image = frameOf(doc.tiles[v - 1]!);
        if (image) ctx.drawImage(image, (i % doc.width) * T, Math.floor(i / doc.width) * T, T, T);
      });
    }
    const objects = [...doc.objects].sort((a, b) => a.y - b.y);
    for (const o of objects) {
      const manifest = manifests.get(o.asset);
      const image = frameOf(o.asset);
      if (!manifest || !image) continue;
      const bottom = (o.y + 1) * T;
      ctx.drawImage(
        image,
        o.x * T,
        bottom - manifest.height * zoom,
        manifest.width * zoom,
        manifest.height * zoom,
      );
    }
    // 막힌 칸
    if (showBlocked) {
      ctx.fillStyle = 'rgba(232, 69, 55, 0.28)';
      layout.blocked.forEach((b, i) => {
        if (b) ctx.fillRect((i % doc.width) * T, Math.floor(i / doc.width) * T, T, T);
      });
    }
    // 격자
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.beginPath();
    for (let x = 1; x < doc.width; x++) {
      ctx.moveTo(x * T + 0.5, 0);
      ctx.lineTo(x * T + 0.5, canvas.height);
    }
    for (let y = 1; y < doc.height; y++) {
      ctx.moveTo(0, y * T + 0.5);
      ctx.lineTo(canvas.width, y * T + 0.5);
    }
    ctx.stroke();
    // 스폰 영역
    const spawn = spawnDrag && hover ? rectOf(spawnDrag, hover) : doc.spawn;
    ctx.strokeStyle = '#3fb950';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(spawn.x * T + 1, spawn.y * T + 1, spawn.w * T - 2, spawn.h * T - 2);
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
    // 놓을 자리 미리보기
    if (hover && !spawnDrag) {
      if (tool === 'object') {
        const manifest = manifests.get(object);
        const image = frameOf(object);
        if (manifest && image) {
          ctx.globalAlpha = 0.6;
          const bottom = (hover.y + 1) * T;
          ctx.drawImage(
            image,
            hover.x * T,
            bottom - manifest.height * zoom,
            manifest.width * zoom,
            manifest.height * zoom,
          );
          ctx.globalAlpha = 1;
        }
      }
      ctx.strokeStyle = '#ffffff';
      ctx.strokeRect(hover.x * T + 0.5, hover.y * T + 0.5, T - 1, T - 1);
    }
  });

  const cellAt = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.floor(((e.clientX - rect.left) / rect.width) * doc.width),
      y: Math.floor(((e.clientY - rect.top) / rect.height) * doc.height),
    };
  };

  const apply = (cell: { x: number; y: number }) => {
    if (tool === 'ground' || tool === 'overlay')
      editor.paint(tool as TileLayer, cell.x, cell.y, tile);
    else if (tool === 'erase') editor.erase(cell.x, cell.y, sizeOf);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const cell = cellAt(e);
    if (tool === 'fill') {
      editor.fill('ground', cell.x, cell.y, tile);
      return;
    }
    if (tool === 'object') {
      editor.placeObject(object, cell.x, cell.y);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === 'spawn') {
      setSpawnDrag(cell);
      return;
    }
    painting.current = cell;
    editor.begin();
    apply(cell);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const cell = cellAt(e);
    if (hover?.x !== cell.x || hover?.y !== cell.y) setHover(cell);
    const last = painting.current;
    if (last && (last.x !== cell.x || last.y !== cell.y)) {
      // 마우스를 빨리 움직여도 칸이 건너뛰지 않게 지난 칸에서 이 칸까지 잇는다.
      const steps = Math.max(Math.abs(cell.x - last.x), Math.abs(cell.y - last.y));
      for (let i = 1; i <= steps; i++) {
        apply({
          x: Math.round(last.x + ((cell.x - last.x) * i) / steps),
          y: Math.round(last.y + ((cell.y - last.y) * i) / steps),
        });
      }
      painting.current = cell;
    }
  };

  const onPointerUp = () => {
    painting.current = null;
    if (spawnDrag && hover) editor.setSpawn(rectOf(spawnDrag, hover));
    setSpawnDrag(null);
  };

  // ── 저장 ──
  const problems = (() => {
    const result = mapDefinitionSchema.safeParse(definition);
    if (!result.success) return result.error.issues.map((i) => i.message);
    return hasStandableSpawn(layout) ? [] : ['스폰 영역에 설 수 있는 칸이 하나도 없습니다.'];
  })();

  const run = async (action: () => Promise<CommunityMapDto>, ok: string) => {
    setBusy(true);
    setStatus(null);
    try {
      const saved = await action();
      editor.replace(fromDefinition(saved.definition));
      setCustom(saved.custom);
      setSize({ w: saved.definition.width, h: saved.definition.height });
      setStatus({ kind: 'ok', text: ok });
    } catch (err) {
      setStatus({
        kind: 'error',
        text: err instanceof ApiError ? err.message : '저장하지 못했습니다.',
      });
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(
      () => apiFetch<CommunityMapDto>(path, { method: 'PUT', ...jsonBody({ definition }) }),
      '저장했습니다. 광장에 있던 사람들은 스폰 영역에서 다시 시작합니다.',
    );

  const reset = () => {
    if (!window.confirm('내장 분수 광장으로 되돌릴까요? 지금 맵은 지워집니다.')) return;
    void run(
      () => apiFetch<CommunityMapDto>(path, { method: 'DELETE' }),
      '내장 맵으로 되돌렸습니다.',
    );
  };

  const list = entries.filter((e) => e.manifest.kind === tab);
  const selected = tab === 'tile' ? tile : object;

  return (
    <div className="pixel-editor map-editor" role="dialog" aria-modal="true" aria-label="맵 에디터">
      <header className="pixel-editor__header">
        <span className="pixel-editor__kind">맵</span>
        <strong>{title}</strong>
        {!custom && <span className="form__hint">내장 맵</span>}
        {status && (
          <p className={status.kind === 'ok' ? 'form__ok' : 'form__error'} role="status">
            {status.text}
          </p>
        )}
        <div className="pixel-editor__actions">
          <label className="pixel-editor__row">
            가로
            <input
              type="number"
              min={MAP_MIN_SIZE}
              max={MAP_MAX_SIZE}
              value={size.w}
              onChange={(e) => setSize({ ...size, w: Number(e.target.value) })}
            />
            세로
            <input
              type="number"
              min={MAP_MIN_SIZE}
              max={MAP_MAX_SIZE}
              value={size.h}
              onChange={(e) => setSize({ ...size, h: Number(e.target.value) })}
            />
            <button
              type="button"
              className="button"
              disabled={size.w === doc.width && size.h === doc.height}
              onClick={() => {
                editor.resize(size.w, size.h);
                setSize({ w: editor.doc.width, h: editor.doc.height });
              }}
            >
              크기 바꾸기
            </button>
          </label>
          <button type="button" className="button" disabled={busy || !custom} onClick={reset}>
            내장 맵으로 되돌리기
          </button>
          <button type="button" className="button" onClick={requestClose}>
            닫기
          </button>
          <button
            type="button"
            className="button button--primary"
            disabled={busy || problems.length > 0 || !editor.dirty}
            title={problems.join(' ') || undefined}
            onClick={() => void save()}
          >
            저장
          </button>
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
              title={t.label}
              onClick={() => {
                setTool(t.id);
                if (t.id === 'object') setTab('object');
                else if (t.id !== 'erase' && t.id !== 'spawn') setTab('tile');
              }}
            >
              {t.icon}
            </button>
          ))}
          <hr />
          <button
            type="button"
            className="pixel-editor__tool"
            aria-pressed={showBlocked}
            title="막힌 칸 보기"
            aria-label="막힌 칸 보기"
            onClick={() => setShowBlocked((v) => !v)}
          >
            <Grid2x2X aria-hidden />
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
            onClick={() => setZoom((z) => Math.min(4, z + 1))}
          >
            <ZoomIn aria-hidden />
          </button>
          <button
            type="button"
            className="pixel-editor__tool"
            title="작게"
            aria-label="작게"
            onClick={() => setZoom((z) => Math.max(1, z - 1))}
          >
            <ZoomOut aria-hidden />
          </button>
        </aside>

        <div className="pixel-editor__stage map-editor__stage">
          <canvas
            ref={canvasRef}
            className="map-editor__canvas"
            width={doc.width * TILE_SIZE * zoom}
            height={doc.height * TILE_SIZE * zoom}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={() => setHover(null)}
          />
        </div>

        <aside className="pixel-editor__side">
          <div className="tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'tile'}
              onClick={() => setTab('tile')}
            >
              타일
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'object'}
              onClick={() => setTab('object')}
            >
              오브젝트
            </button>
          </div>
          <p className="form__hint">
            {tab === 'tile'
              ? '바닥은 땅, 장식은 바닥 위에 겹쳐 그립니다. 빨간 칸은 지나갈 수 없습니다.'
              : '누른 칸이 오브젝트 그림의 왼쪽 아래가 됩니다.'}
          </p>
          <ul className="map-editor__palette">
            {list.map((entry) => (
              <li key={entry.ref}>
                <button
                  type="button"
                  aria-pressed={entry.ref === selected}
                  title={`${entry.manifest.name}${entry.community ? ' (커뮤니티)' : ''}`}
                  onClick={() => {
                    if (tab === 'tile') {
                      setTile(entry.ref);
                      if (tool !== 'ground' && tool !== 'overlay' && tool !== 'fill')
                        setTool('ground');
                    } else {
                      setObject(entry.ref);
                      setTool('object');
                    }
                  }}
                >
                  <AssetPreview manifest={entry.manifest} box={PALETTE_BOX} animate={false} />
                  {entry.community && (
                    <span className="map-editor__badge" title="이 커뮤니티의 에셋">
                      <Star aria-label="커뮤니티 에셋" role="img" />
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {problems.length > 0 && (
            <p className="form__error" role="alert">
              {problems.join(' ')}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

function rectOf(a: { x: number; y: number }, b: { x: number; y: number }) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1 };
}
