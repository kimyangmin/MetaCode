import {
  type AssetManifest,
  type AssetRef,
  Cell,
  type CommunityMapDto,
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
import { useUnsavedGuard } from './unsavedGuard';
import { ApiError, apiFetch } from '../../api/client';
import { announceAssetsChanged } from './editorWindow';
import { jsonBody } from '../../api/queries';
import { AssetPreview } from './AssetPreview';
import { useCommunityAssets } from './api';
import { firstFrame, paintMap } from './mapCanvas';
import {
  MapDocument,
  type TileLayer,
  fromDefinition,
  isSideDoc,
  tileSize,
  toDefinition,
} from './mapModel';
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

const TOOLS: { id: Tool; label: string; side?: string; icon: ReactNode }[] = [
  { id: 'ground', label: '바닥 칠하기', side: '땅·배경 칠하기', icon: <Brush aria-hidden /> },
  {
    id: 'overlay',
    label: '장식 칠하기 (바닥 위에 겹침)',
    side: '장식 칠하기 (캐릭터 앞에 겹침)',
    icon: <Flower2 aria-hidden />,
  },
  { id: 'fill', label: '바닥 채우기', side: '땅·배경 채우기', icon: <PaintBucket aria-hidden /> },
  { id: 'object', label: '오브젝트 놓기', icon: <TreePine aria-hidden /> },
  {
    id: 'erase',
    label: '지우기 (오브젝트, 장식)',
    side: '지우기 (오브젝트, 장식, 땅)',
    icon: <Eraser aria-hidden />,
  },
  { id: 'spawn', label: '스폰 영역 (끌어서)', icon: <Flag aria-hidden /> },
];

/** 횡스크롤 맵의 팔레트에서 앞에 보일 타일 (옆에서 본 타일) */
const isSideTile = (ref: AssetRef) => ref.startsWith('builtin:side-');

interface Entry {
  ref: AssetRef;
  manifest: AssetManifest;
  community: boolean;
}

/**
 * 맵 에디터: 커뮤니티 분수 광장의 타일(바닥·장식)을 칠하고 오브젝트를 놓는다.
 * 저장하면 광장을 보던 사람들의 화면이 새 맵으로 바뀌고 모두 스폰 영역에서 다시 시작한다.
 * 횡스크롤 광장이면 옆에서 본 맵이다: 빈칸은 하늘이고, 지나갈 수 없는 타일로 땅을, 발판 타일로 발판을 만든다.
 */
/** 맵 배율 (1~4배, Ctrl+0이면 기본) */
const MAP_ZOOM_DEFAULT = 2;
const mapZoomIn = (z: number) => Math.min(4, z + 1);
const mapZoomOut = (z: number) => Math.max(1, z - 1);
/** Ctrl+휠: 이만큼 모이면 한 단계 */
const MAP_WHEEL_STEP = 60;

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
      communityId={communityId}
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
  communityId,
  path,
  title,
  initial,
  entries,
  onClose,
}: {
  communityId: string;
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
  const side = isSideDoc(editor.doc);
  const [custom, setCustom] = useState(initial.custom);
  const [tool, setTool] = useState<Tool>('ground');
  const [tab, setTab] = useState<'tile' | 'object'>('tile');
  const [tile, setTile] = useState<AssetRef>(side ? 'builtin:side-grass' : 'builtin:tt-0');
  const [object, setObject] = useState<AssetRef>('builtin:bench');
  const [zoom, setZoom] = useState(MAP_ZOOM_DEFAULT);
  const stageRef = useRef<HTMLDivElement>(null);
  const wheel = useRef(0);
  const [showBlocked, setShowBlocked] = useState(true);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [spawnDrag, setSpawnDrag] = useState<{ x: number; y: number } | null>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [size, setSize] = useState({ w: editor.doc.width, h: editor.doc.height });
  // 되돌리기로 크기가 바뀌면 크기 칸도 따라간다 (예전엔 예전 값이 남아 "크기 바꾸기"가 켜져 있었다).
  const [shownSize, setShownSize] = useState(`${editor.doc.width}x${editor.doc.height}`);
  if (shownSize !== `${editor.doc.width}x${editor.doc.height}`) {
    setShownSize(`${editor.doc.width}x${editor.doc.height}`);
    setSize({ w: editor.doc.width, h: editor.doc.height });
  }
  const painting = useRef<{ x: number; y: number } | null>(null);

  const manifests = useMemo(() => new Map(entries.map((e) => [e.ref, e.manifest])), [entries]);
  const assetOf = useCallback((ref: AssetRef) => manifests.get(ref), [manifests]);
  const sizeOf = useCallback((ref: AssetRef) => tileSize(manifests.get(ref)), [manifests]);

  const doc = editor.doc;
  const definition = toDefinition(doc);
  const layout = buildCollision(definition, assetOf);

  /** 닫기를 확인받았다 (창을 닫을 때 브라우저가 한 번 더 묻지 않게) */
  const discarding = useRef(false);
  const requestClose = useCallback(() => {
    if (editor.dirty && !window.confirm('저장하지 않은 변경이 있습니다. 닫을까요?')) return;
    discarding.current = true;
    onClose();
  }, [editor, onClose]);
  useUnsavedGuard(editor, discarding);

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
      } else if (mod && (e.code === 'Equal' || e.code === 'NumpadAdd' || e.key === '+')) {
        // 브라우저 확대 대신 맵을 키운다 (도트 에디터와 같은 단축키)
        e.preventDefault();
        setZoom(mapZoomIn);
      } else if (mod && (e.code === 'Minus' || e.code === 'NumpadSubtract' || e.key === '-')) {
        e.preventDefault();
        setZoom(mapZoomOut);
      } else if (mod && (e.code === 'Digit0' || e.code === 'Numpad0')) {
        e.preventDefault();
        setZoom(MAP_ZOOM_DEFAULT);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [editor, requestClose]);

  // Ctrl+휠(트랙패드 모아 벌리기)은 맵 배율. React의 onWheel은 passive라 브라우저 확대를 막지 못해 직접 건다.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      wheel.current += e.deltaY;
      while (Math.abs(wheel.current) >= MAP_WHEEL_STEP) {
        setZoom(wheel.current < 0 ? mapZoomIn : mapZoomOut);
        wheel.current -= Math.sign(wheel.current) * MAP_WHEEL_STEP;
      }
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, []);

  // ── 그리기 ──
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const T = TILE_SIZE * zoom;
    paintMap(ctx, doc, zoom, assetOf);
    // 막힌 칸 (빨강), 횡스크롤의 발판 (노랑 윗변: 위에서만 딛는다)
    if (showBlocked) {
      layout.blocked.forEach((b, i) => {
        if (!b) return;
        const x = (i % doc.width) * T;
        const y = Math.floor(i / doc.width) * T;
        if (b === Cell.Platform) {
          ctx.fillStyle = 'rgba(253, 190, 83, 0.6)';
          ctx.fillRect(x, y, T, Math.max(2, T / 4));
        } else {
          ctx.fillStyle = 'rgba(232, 69, 55, 0.28)';
          ctx.fillRect(x, y, T, T);
        }
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
        if (manifest) {
          ctx.globalAlpha = 0.6;
          const bottom = (hover.y + 1) * T;
          ctx.drawImage(
            firstFrame(manifest),
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

  // 뗀 자리로 스폰 영역을 정한다 (예전엔 마우스가 올라가 있던 칸을 써서, 올려 둔 칸이 없는 손가락 화면에서는
  // 정해지지 않았다).
  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    painting.current = null;
    if (spawnDrag) editor.setSpawn(rectOf(spawnDrag, cellAt(e)));
    setSpawnDrag(null);
  };

  const onPointerCancel = () => {
    painting.current = null;
    setSpawnDrag(null);
  };

  // ── 저장 ──
  const problems = (() => {
    const result = mapDefinitionSchema.safeParse(definition);
    if (!result.success) return result.error.issues.map((i) => i.message);
    return hasStandableSpawn(layout) ? [] : ['스폰 영역에 설 수 있는 칸이 하나도 없습니다.'];
  })();

  const run = async (
    action: () => Promise<CommunityMapDto>,
    ok: string,
    /** 저장처럼 지금 문서를 보낸 것이면 true: 기다리는 동안 더 고쳤으면 그 문서를 그대로 둔다 */
    keepEdits = false,
  ) => {
    setBusy(true);
    setStatus(null);
    const version = editor.version;
    try {
      const saved = await action();
      if (keepEdits && editor.version !== version) {
        // 보낸 뒤에 더 고친 것을 서버 응답으로 덮어쓰지 않는다 (그 변경은 아직 저장하지 않은 것으로 남음)
        editor.markSaved(version);
      } else {
        editor.replace(fromDefinition(saved.definition));
      }
      setCustom(saved.custom);
      setStatus({ kind: 'ok', text: ok });
      announceAssetsChanged(communityId);
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
      true,
    );

  const reset = () => {
    if (!window.confirm('내장 분수 광장으로 되돌릴까요? 지금 맵은 지워집니다.')) return;
    void run(
      () => apiFetch<CommunityMapDto>(path, { method: 'DELETE' }),
      '내장 맵으로 되돌렸습니다.',
    );
  };

  // 횡스크롤이면 옆에서 본 타일을 앞에 둔다.
  const list = entries
    .filter((e) => e.manifest.kind === tab)
    .sort((a, b) => (side ? Number(isSideTile(b.ref)) - Number(isSideTile(a.ref)) : 0));
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
              aria-label={(side && t.side) || t.label}
              title={(side && t.side) || t.label}
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
            title="크게 (Ctrl + 또는 Ctrl+휠)"
            aria-label="크게"
            onClick={() => setZoom(mapZoomIn)}
          >
            <ZoomIn aria-hidden />
          </button>
          <button
            type="button"
            className="pixel-editor__tool"
            title="작게 (Ctrl − 또는 Ctrl+휠)"
            aria-label="작게"
            onClick={() => setZoom(mapZoomOut)}
          >
            <ZoomOut aria-hidden />
          </button>
        </aside>

        <div className="pixel-editor__stage map-editor__stage" ref={stageRef}>
          <canvas
            ref={canvasRef}
            className="map-editor__canvas"
            width={doc.width * TILE_SIZE * zoom}
            height={doc.height * TILE_SIZE * zoom}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
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
              ? side
                ? '옆에서 본 맵입니다. 빈칸은 하늘이고, 빨간 칸(지나갈 수 없는 타일)은 딛고 서는 땅, 노란 선(발판)은 위에서만 딛습니다. 장식은 캐릭터 앞에 겹쳐 그립니다.'
                : '바닥은 땅, 장식은 바닥 위에 겹쳐 그립니다. 빨간 칸은 지나갈 수 없습니다.'
              : side
                ? '누른 칸이 오브젝트 그림의 왼쪽 아래가 됩니다. 횡스크롤에서 오브젝트는 배경이라 막지 않습니다.'
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
