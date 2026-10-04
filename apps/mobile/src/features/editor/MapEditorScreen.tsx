import {
  MapDocument,
  type TileLayer,
  fromDefinition,
  isSideDoc,
  tileSize,
  toDefinition,
} from '@metacode/client';
import {
  type AssetManifest,
  type AssetRef,
  type CommunityMapDto,
  MAP_MAX_SIZE,
  MAP_MIN_SIZE,
  TILE_SIZE,
  buildCollision,
  hasStandableSpawn,
  mapDefinitionSchema,
} from '@metacode/shared';
import { BUILTIN_ASSETS } from '@metacode/shared/builtin-assets';
import { Canvas, Group, Picture } from '@shopify/react-native-skia';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import {
  Brush,
  Eraser,
  Flag,
  Flower2,
  Grid2x2X,
  PaintBucket,
  Redo2,
  Save,
  SlidersHorizontal,
  Star,
  TreePine,
  Undo2,
  X,
} from 'lucide-react-native';
import { type ComponentType, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCommunityAssets } from '../../api/assets';
import { ApiError, apiFetch, apiSend } from '../../api/client';
import type { MapEditorTarget } from '../../stores/editor';
import { Sheet } from '../../ui/Sheet';
import { Button, Segmented, TextField } from '../../ui/controls';
import { useTheme } from '../../ui/theme';
import { FrameImages } from '../plaza/images';
import { IconButton, ToolButton } from './buttons';
import { CanvasGestures } from './canvasGestures';
import { drawMapPicture } from './mapDraw';
import { thumbnailUri } from './thumbnails';

type Tool = 'ground' | 'overlay' | 'fill' | 'object' | 'erase' | 'spawn';

interface Entry {
  ref: AssetRef;
  manifest: AssetManifest;
  community: boolean;
}

/** 횡스크롤 맵의 팔레트에서 앞에 보일 타일 (옆에서 본 타일) */
const isSideTile = (ref: AssetRef) => ref.startsWith('builtin:side-');

const rectOf = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.abs(a.x - b.x) + 1,
  h: Math.abs(a.y - b.y) + 1,
});

/**
 * 맵 에디터 (웹 MapEditor의 휴대폰판): 커뮤니티 분수 광장의 바닥·장식 타일을 칠하고 오브젝트를 놓는다.
 * 한 손가락으로 칠하고 두 손가락으로 확대·이동한다. 오브젝트는 손가락을 댄 채 옮겨 자리를 보고 떼면 놓는다.
 * 저장하면 광장을 보던 사람들의 화면이 새 맵으로 바뀌고 모두 스폰 영역에서 다시 시작한다.
 */
export function MapEditorScreen({ target, onClose }: { target: MapEditorTarget; onClose(): void }) {
  const theme = useTheme();
  const path = `/communities/${target.communityId}/map`;
  // 다른 관리자가 고쳤을 수 있으니 열 때마다 새로 받는다 (웹과 같음)
  const loaded = useQuery({
    queryKey: ['community-map', target.communityId],
    queryFn: () => apiFetch<CommunityMapDto>(path),
    staleTime: 0,
    gcTime: 0,
  });
  const communityAssets = useCommunityAssets(target.communityId).data;
  const entries = useMemo<Entry[] | null>(
    () =>
      communityAssets
        ? [
            ...Object.entries(BUILTIN_ASSETS)
              .filter(([, m]) => m.kind !== 'character')
              .map(([ref, manifest]) => ({ ref, manifest, community: false })),
            ...communityAssets.map((a) => ({ ref: a.id, manifest: a.manifest, community: true })),
          ]
        : null,
    [communityAssets],
  );

  if (!loaded.data || !loaded.isFetchedAfterMount || !entries) {
    return (
      <View style={[styles.root, styles.center, { backgroundColor: theme.bg }]}>
        {loaded.isError ? (
          <>
            <Text style={{ color: theme.danger }}>맵을 불러오지 못했습니다.</Text>
            <Button label="닫기" onPress={onClose} />
          </>
        ) : (
          <ActivityIndicator color={theme.muted} />
        )}
      </View>
    );
  }
  return (
    <MapEditorBody
      path={path}
      title={`${target.communityName} 광장`}
      initial={loaded.data}
      entries={entries}
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
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [editor] = useState(() => new MapDocument(fromDefinition(initial.definition), rerender));
  const [frames] = useState(() => new FrameImages());
  useEffect(() => () => frames.dispose(), [frames]);
  const side = isSideDoc(editor.doc);
  const [custom, setCustom] = useState(initial.custom);
  const [tool, setTool] = useState<Tool>('ground');
  const [tab, setTab] = useState<'tile' | 'object'>('tile');
  const [tile, setTile] = useState<AssetRef>(side ? 'builtin:side-grass' : 'builtin:tt-0');
  const [object, setObject] = useState<AssetRef>('builtin:bench');
  const [showBlocked, setShowBlocked] = useState(true);
  /** 손가락을 댄 채인 칸: 오브젝트 놓을 자리, 스폰 영역 끄기 */
  const [drag, setDrag] = useState<{
    from: { x: number; y: number };
    to: { x: number; y: number };
  } | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  const manifests = useMemo(() => new Map(entries.map((e) => [e.ref, e.manifest])), [entries]);
  const assetOf = (ref: AssetRef) => manifests.get(ref);
  const sizeOf = (ref: AssetRef) => tileSize(manifests.get(ref));

  const doc = editor.doc;
  const definition = toDefinition(doc);
  const layout = buildCollision(definition, assetOf);
  const spawn = tool === 'spawn' && drag ? rectOf(drag.from, drag.to) : doc.spawn;
  const preview = tool === 'object' && drag ? { ref: object, ...drag.to } : null;
  const picture = drawMapPicture(doc, layout, assetOf, frames, { showBlocked, spawn, preview });

  const problems = (() => {
    const result = mapDefinitionSchema.safeParse(definition);
    if (!result.success) return result.error.issues.map((i) => i.message);
    return hasStandableSpawn(layout) ? [] : ['스폰 영역에 설 수 있는 칸이 하나도 없습니다.'];
  })();

  const close = () => {
    if (!editor.dirty) {
      onClose();
      return;
    }
    Alert.alert('저장하지 않고 닫을까요?', '고친 내용이 사라집니다.', [
      { text: '계속 고치기', style: 'cancel' },
      { text: '닫기', style: 'destructive', onPress: onClose },
    ]);
  };
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeRef.current();
      return true;
    });
    return () => sub.remove();
  }, []);

  // ── 칠하기 ──
  const apply = (cell: { x: number; y: number }) => {
    if (tool === 'ground' || tool === 'overlay')
      editor.paint(tool as TileLayer, cell.x, cell.y, tile);
    else if (tool === 'erase') editor.erase(cell.x, cell.y, sizeOf);
  };

  const onStroke = (phase: 'start' | 'move' | 'end', x: number, y: number) => {
    const cell = { x, y };
    if (tool === 'fill') {
      if (phase === 'start') editor.fill('ground', x, y, tile);
      return;
    }
    if (tool === 'object' || tool === 'spawn') {
      if (phase === 'start') setDrag({ from: cell, to: cell });
      else if (phase === 'move') setDrag((d) => (d ? { ...d, to: cell } : d));
      else {
        if (tool === 'object') editor.placeObject(object, x, y);
        else if (drag) editor.setSpawn(rectOf(drag.from, cell));
        setDrag(null);
      }
      return;
    }
    if (phase === 'start') {
      editor.begin();
      last.current = cell;
      apply(cell);
    } else if (phase === 'move' && last.current) {
      const from = last.current;
      // 손가락을 빨리 움직여도 칸이 건너뛰지 않게 지난 칸에서 이 칸까지 잇는다
      const steps = Math.max(Math.abs(x - from.x), Math.abs(y - from.y));
      for (let i = 1; i <= steps; i++) {
        apply({
          x: Math.round(from.x + ((x - from.x) * i) / steps),
          y: Math.round(from.y + ((y - from.y) * i) / steps),
        });
      }
      last.current = cell;
    } else {
      last.current = null;
    }
  };

  // ── 저장 ──
  const run = async (action: () => Promise<CommunityMapDto>, ok: string, keepEdits = false) => {
    setBusy(true);
    setStatus(null);
    const version = editor.version;
    try {
      const saved = await action();
      // 보낸 뒤에 더 고친 것을 서버 응답으로 덮어쓰지 않는다 (웹과 같음)
      if (keepEdits && editor.version !== version) editor.markSaved(version);
      else editor.replace(fromDefinition(saved.definition));
      setCustom(saved.custom);
      setStatus({ ok: true, text: ok });
    } catch (error) {
      setStatus({
        ok: false,
        text: error instanceof ApiError ? error.message : '저장하지 못했습니다.',
      });
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    run(
      () => apiSend<CommunityMapDto>(path, 'PUT', { definition }),
      '저장했습니다. 광장에 있던 사람들은 스폰 영역에서 다시 시작합니다.',
      true,
    );
  const reset = () =>
    Alert.alert('내장 맵으로 되돌릴까요?', '지금 맵은 지워집니다.', [
      { text: '취소', style: 'cancel' },
      {
        text: '되돌리기',
        style: 'destructive',
        onPress: () => {
          setOptionsOpen(false);
          void run(
            () => apiFetch<CommunityMapDto>(path, { method: 'DELETE' }),
            '내장 맵으로 되돌렸습니다.',
          );
        },
      },
    ]);

  const list = entries
    .filter((e) => e.manifest.kind === tab)
    .sort((a, b) => (side ? Number(isSideTile(b.ref)) - Number(isSideTile(a.ref)) : 0));
  const selected = tab === 'tile' ? tile : object;

  const tools: { id: Tool; icon: ComponentType<{ color: string; size: number }>; label: string }[] =
    [
      { id: 'ground', icon: Brush, label: side ? '땅·배경 칠하기' : '바닥 칠하기' },
      { id: 'overlay', icon: Flower2, label: '장식 칠하기' },
      { id: 'fill', icon: PaintBucket, label: side ? '땅·배경 채우기' : '바닥 채우기' },
      { id: 'object', icon: TreePine, label: '오브젝트 놓기' },
      { id: 'erase', icon: Eraser, label: '지우기' },
      { id: 'spawn', icon: Flag, label: '스폰 영역 (끌어서)' },
    ];
  const pickTool = (id: Tool) => {
    setTool(id);
    // 오브젝트를 놓을 때는 오브젝트 팔레트, 칠할 때는 타일 팔레트
    if (id === 'object') setTab('object');
    else if (id === 'ground' || id === 'overlay' || id === 'fill') setTab('tile');
  };

  const statusText =
    status?.text ??
    (problems.length > 0
      ? problems[0]!
      : editor.dirty
        ? '저장하지 않은 변경이 있습니다.'
        : custom
          ? null
          : '내장 맵입니다. 저장하면 이 커뮤니티의 맵이 됩니다.');

  return (
    <View style={[styles.root, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <IconButton icon={X} label="맵 에디터 닫기" onPress={close} />
        <Text style={[styles.title, { color: theme.fg }]} numberOfLines={1}>
          {title}
        </Text>
        <IconButton
          icon={Undo2}
          label="되돌리기"
          disabled={!editor.canUndo}
          onPress={() => editor.undo()}
        />
        <IconButton
          icon={Redo2}
          label="다시 하기"
          disabled={!editor.canRedo}
          onPress={() => editor.redo()}
        />
        <IconButton icon={SlidersHorizontal} label="맵 설정" onPress={() => setOptionsOpen(true)} />
        <Pressable
          onPress={() => void save()}
          disabled={busy || problems.length > 0}
          accessibilityRole="button"
          accessibilityLabel="저장"
          style={[
            styles.save,
            { backgroundColor: theme.accent, opacity: busy || problems.length > 0 ? 0.5 : 1 },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={theme.accentFg} />
          ) : (
            <Save color={theme.accentFg} size={18} />
          )}
        </Pressable>
      </View>
      {statusText && (
        <Text
          style={[
            styles.status,
            {
              color: status
                ? status.ok
                  ? theme.ok
                  : theme.danger
                : problems.length > 0
                  ? theme.warn
                  : theme.muted,
            },
          ]}
          numberOfLines={2}
        >
          {statusText}
        </Text>
      )}

      <MapCanvas
        picture={picture}
        width={doc.width * TILE_SIZE}
        height={doc.height * TILE_SIZE}
        background={theme.bgRail}
        onStroke={onStroke}
      />

      <View style={[styles.tools, { borderTopColor: theme.border }]}>
        {tools.map((t) => (
          <ToolButton
            key={t.id}
            icon={t.icon}
            label={t.label}
            active={tool === t.id}
            onPress={() => pickTool(t.id)}
          />
        ))}
        <ToolButton
          icon={Grid2x2X}
          label="막힌 칸 보기"
          active={showBlocked}
          onPress={() => setShowBlocked((v) => !v)}
        />
      </View>

      <View style={[styles.tabs, { paddingHorizontal: 10 }]}>
        <Segmented<'tile' | 'object'>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'tile', label: '타일' },
            { value: 'object', label: '오브젝트' },
          ]}
        />
      </View>
      <ScrollView
        horizontal
        style={styles.paletteScroll}
        contentContainerStyle={[styles.palette, { paddingBottom: insets.bottom + 10 }]}
        showsHorizontalScrollIndicator={false}
      >
        {list.map((e) => {
          const active = e.ref === selected;
          const uri = thumbnailUri(e.manifest);
          return (
            <Pressable
              key={e.ref}
              onPress={() => {
                if (tab === 'tile') {
                  setTile(e.ref);
                  if (tool === 'object' || tool === 'erase' || tool === 'spawn') setTool('ground');
                } else {
                  setObject(e.ref);
                  setTool('object');
                }
              }}
              accessibilityRole="button"
              accessibilityLabel={e.manifest.name}
              accessibilityState={{ selected: active }}
              style={[
                styles.item,
                {
                  backgroundColor: side ? '#9fd8f5' : theme.bgInput,
                  borderColor: active ? theme.accent : theme.border,
                },
              ]}
            >
              {uri && <Image source={{ uri }} style={styles.thumb} contentFit="contain" />}
              {e.community && (
                <View style={styles.star}>
                  <Star color="#fdbe53" fill="#fdbe53" size={12} />
                </View>
              )}
            </Pressable>
          );
        })}
      </ScrollView>

      <MapOptions
        visible={optionsOpen}
        width={doc.width}
        height={doc.height}
        custom={custom}
        onResize={(w, h) => {
          editor.resize(w, h);
          setOptionsOpen(false);
        }}
        onReset={reset}
        onClose={() => setOptionsOpen(false)}
      />
    </View>
  );
}

/** 맵 그림판: 맵 그림을 화면에 맞춰 키워 그리고, 한 손가락 = 칸 단위 칠하기, 두 손가락 = 확대·이동 */
function MapCanvas({
  picture,
  width,
  height,
  background,
  onStroke,
}: {
  picture: ReturnType<typeof drawMapPicture>;
  /** 맵 크기 (월드 픽셀) */
  width: number;
  height: number;
  background: string;
  onStroke(phase: 'start' | 'move' | 'end', x: number, y: number): void;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const fit = size.width > 0 ? Math.min(size.width / width, size.height / height) * 0.96 : 1;
  const scale = fit * zoom;
  const left = (size.width - width * scale) / 2 + pan.x;
  const top = (size.height - height * scale) / 2 + pan.y;
  const cell = TILE_SIZE * scale;

  const [controls] = useState(() => new CanvasGestures(8));
  useEffect(() => {
    controls.sync({ left, top, cell, zoom, pan }, onStroke, setZoom, setPan);
  }, [controls, left, top, cell, zoom, pan, onStroke]);

  return (
    <GestureDetector gesture={controls.gesture}>
      <View
        style={[styles.stage, { backgroundColor: background }]}
        onLayout={(e) => setSize(e.nativeEvent.layout)}
      >
        <Canvas style={StyleSheet.absoluteFill}>
          <Group transform={[{ translateX: left }, { translateY: top }, { scale }]}>
            <Picture picture={picture} />
          </Group>
        </Canvas>
      </View>
    </GestureDetector>
  );
}

/** 맵 설정: 크기(왼쪽 위 기준으로 늘리고 줄임), 내장 맵으로 되돌리기 */
function MapOptions({
  visible,
  width,
  height,
  custom,
  onResize,
  onReset,
  onClose,
}: {
  visible: boolean;
  width: number;
  height: number;
  custom: boolean;
  onResize(width: number, height: number): void;
  onReset(): void;
  onClose(): void;
}) {
  const theme = useTheme();
  const [w, setW] = useState(String(width));
  const [h, setH] = useState(String(height));
  const [shown, setShown] = useState(visible);
  // 열 때마다 지금 크기로 채운다
  if (visible !== shown) {
    setShown(visible);
    if (visible) {
      setW(String(width));
      setH(String(height));
    }
  }
  const nw = Number(w);
  const nh = Number(h);
  const valid = [nw, nh].every(
    (n) => Number.isInteger(n) && n >= MAP_MIN_SIZE && n <= MAP_MAX_SIZE,
  );
  return (
    <Sheet visible={visible} title="맵 설정" onClose={onClose}>
      <Text style={{ color: theme.muted, fontSize: 12 }}>
        크기는 {MAP_MIN_SIZE}~{MAP_MAX_SIZE}칸입니다. 왼쪽 위를 기준으로 늘리거나 줄입니다.
      </Text>
      <View style={styles.sizeRow}>
        <View style={styles.flex}>
          <TextField label="가로" value={w} onChangeText={setW} keyboardType="number-pad" />
        </View>
        <View style={styles.flex}>
          <TextField label="세로" value={h} onChangeText={setH} keyboardType="number-pad" />
        </View>
      </View>
      <Button
        label="크기 바꾸기"
        variant="primary"
        disabled={!valid || (nw === width && nh === height)}
        onPress={() => onResize(nw, nh)}
      />
      {custom && <Button label="내장 맵으로 되돌리기" variant="danger" onPress={onReset} />}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, zIndex: 10 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { flex: 1, fontSize: 16, fontWeight: '700', paddingHorizontal: 6 },
  save: {
    width: 42,
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  status: { fontSize: 12, paddingHorizontal: 12, paddingVertical: 4 },
  stage: { flex: 1, overflow: 'hidden' },
  tools: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tabs: { paddingTop: 8 },
  // 가로 ScrollView는 기본이 flexGrow: 1이라 남는 높이를 가져간다
  paletteScroll: { flexGrow: 0 },
  palette: { gap: 8, paddingHorizontal: 10, paddingTop: 10, alignItems: 'center' },
  item: {
    width: 52,
    height: 52,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumb: { width: 40, height: 40 },
  star: { position: 'absolute', top: 2, right: 2 },
  sizeRow: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
});
