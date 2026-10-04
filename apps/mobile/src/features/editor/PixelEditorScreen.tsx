import {
  type EditorAnimation,
  type EditorDoc,
  type FrameRef,
  PixelDocument,
  fromManifest,
  toManifest,
} from '@metacode/client';
import {
  CHARACTER_PLAZA_HEIGHTS,
  PlazaStyle,
  STANDARD_ANIMATIONS,
  assetManifestSchema,
} from '@metacode/shared';
import { Canvas, FilterMode, Image, MipmapMode } from '@shopify/react-native-skia';
import { useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Eraser,
  FlipHorizontal2,
  Layers,
  PaintBucket,
  Pencil,
  Pipette,
  Plus,
  Redo2,
  Save,
  SlidersHorizontal,
  Trash2,
  Undo2,
  X,
} from 'lucide-react-native';
import { type ComponentType, useEffect, useReducer, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { saveAsset } from '../../api/assets';
import { ApiError } from '../../api/client';
import type { EditorTarget } from '../../stores/editor';
import { Segmented } from '../../ui/controls';
import { Sheet } from '../../ui/Sheet';
import { useTheme } from '../../ui/theme';
import { ColorSheet } from './ColorSheet';
import { EditorCanvas } from './EditorCanvas';
import { EditorFrameImages } from './frameImages';

type Tool = 'pencil' | 'eraser' | 'fill' | 'pick' | 'footprint';

const KIND_LABEL = { tile: '타일', object: '오브젝트', character: '캐릭터' } as const;
const ANIMATION_LABEL = new Map<string, string>([
  ...[...STANDARD_ANIMATIONS.values()].map((a) => [a.name, a.label] as const),
  ['default', '기본'],
]);
const animationLabel = (a: EditorAnimation) => a.label ?? ANIMATION_LABEL.get(a.name) ?? a.name;
const BRUSHES = [1, 2, 3] as const;

/**
 * 도트 에디터 (웹 PixelEditor의 휴대폰판, 손가락 조작에 맞춰 줄임): 연필·지우개·채우기·스포이트, 좌우 대칭,
 * 앞 프레임 겹쳐 보기, 붓 굵기, 팔레트(색 더하기·바꾸기·지우기), 애니메이션 고르기와 프레임 넘기기·넣기·복제·지우기,
 * 움직이는 미리보기, 되돌리기, 저장. 종류별 설정: 타일(지나갈 수 없음·발판), 오브젝트(막힌 칸), 캐릭터(광장 방식·크기).
 * 해상도·자르기·올가미·GIF·애니메이터·모션 키는 웹·데스크톱 에디터에서 한다 (같은 형식이라 함께 쓴다).
 */
export function PixelEditorScreen({ target, onClose }: { target: EditorTarget; onClose(): void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [editor] = useState(
    () =>
      new PixelDocument(
        target.mode === 'create' ? target.doc : fromManifest(target.asset.manifest),
        rerender,
      ),
  );
  const [images] = useState(() => new EditorFrameImages());
  const [savedId, setSavedId] = useState(target.mode === 'edit' ? target.asset.id : undefined);
  const communityId = target.mode === 'edit' ? target.asset.communityId : target.communityId;
  const [ref, setRef] = useState<FrameRef>({ animation: 0, frame: 0 });
  const [tool, setTool] = useState<Tool>('pencil');
  const [color, setColor] = useState(1);
  const [brush, setBrush] = useState<(typeof BRUSHES)[number]>(1);
  const [mirror, setMirror] = useState(false);
  const [onionOn, setOnionOn] = useState(false);
  const [colorEdit, setColorEdit] = useState<{ value: number | null } | null>(null);
  const [animationsOpen, setAnimationsOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);

  const doc: EditorDoc = editor.doc;
  const animation = doc.animations[ref.animation] ?? doc.animations[0]!;
  const frameIndex = Math.min(ref.frame, animation.frames.length - 1);
  const current = {
    animation: Math.min(ref.animation, doc.animations.length - 1),
    frame: frameIndex,
  };
  const pixels = animation.frames[frameIndex]!;
  const image = images.image(pixels, doc.width, doc.height, doc.palette);
  const onion =
    onionOn && frameIndex > 0
      ? images.image(animation.frames[frameIndex - 1]!, doc.width, doc.height, doc.palette)
      : null;
  const missing = doc.kind === 'character' ? editor.missingAnimations() : [];
  const safeColor = Math.min(color, doc.palette.length);

  const close = () => {
    if (!editor.dirty) {
      onClose();
      return;
    }
    Alert.alert('저장하지 않고 닫을까요?', '고친 내용이 사라집니다.', [
      { text: '계속 그리기', style: 'cancel' },
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

  // ── 그리기 ──

  /** 두 점 사이를 빈틈없이 칠한다 (손가락이 빨리 움직여도 선이 끊기지 않게) */
  const line = (from: { x: number; y: number }, to: { x: number; y: number }, value: number) => {
    const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
    for (let i = 1; i <= steps; i++) {
      const x = Math.round(from.x + ((to.x - from.x) * i) / steps);
      const y = Math.round(from.y + ((to.y - from.y) * i) / steps);
      editor.paint(current, x, y, value, mirror, brush);
    }
  };

  const onStroke = (phase: 'start' | 'move' | 'end', x: number, y: number) => {
    const inside = x >= 0 && y >= 0 && x < doc.width && y < doc.height;
    if (tool === 'pick') {
      if (phase === 'end' && inside) {
        const value = editor.pick(current, x, y);
        if (value > 0) {
          setColor(value);
          setTool('pencil');
        }
      }
      return;
    }
    if (tool === 'fill') {
      if (phase === 'start' && inside) editor.fill(current, x, y, safeColor);
      return;
    }
    if (tool === 'footprint') {
      if (phase === 'start' && inside) {
        const columns = Math.round(doc.width / 16);
        editor.toggleFootprint(Math.floor(y / 16) * columns + Math.floor(x / 16));
      }
      return;
    }
    const value = tool === 'eraser' ? 0 : safeColor;
    if (phase === 'start') {
      editor.beginStroke();
      last.current = { x, y };
      editor.paint(current, x, y, value, mirror, brush);
    } else if (phase === 'move' && last.current) {
      if (last.current.x !== x || last.current.y !== y) line(last.current, { x, y }, value);
      last.current = { x, y };
    } else {
      last.current = null;
    }
  };

  // ── 프레임 ──

  const goFrame = (step: number) => {
    const count = animation.frames.length;
    setRef({ animation: current.animation, frame: (frameIndex + step + count) % count });
  };
  const addFrame = (copy: boolean) => {
    const added = editor.addFrame(current, copy);
    if (added === null)
      Alert.alert('프레임을 더 넣을 수 없습니다', '에셋 하나의 그림 수 한도입니다.');
    else setRef({ animation: current.animation, frame: added });
  };
  const removeFrame = () => {
    if (animation.frames.length <= 1) return;
    editor.removeFrame(current);
    setRef({ animation: current.animation, frame: Math.max(0, frameIndex - 1) });
  };

  // ── 저장 ──

  const save = async () => {
    // 캐릭터는 저장할 때 발 아래·머리 위·양옆의 빈 줄을 정리한다 (웹 기본값과 같음)
    if (doc.kind === 'character') {
      editor.trimBelowFeet();
      editor.trimMargins();
    }
    const result = assetManifestSchema.safeParse(toManifest(editor.doc));
    const version = editor.version;
    if (!result.success) {
      setStatus({ ok: false, text: result.error.issues.map((i) => i.message).join(' ') });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const asset = await saveAsset(queryClient, { id: savedId, communityId }, result.data);
      setSavedId(asset.id);
      editor.markSaved(version);
      setStatus({ ok: true, text: '저장했습니다.' });
    } catch (error) {
      setStatus({
        ok: false,
        text:
          error instanceof ApiError || error instanceof Error
            ? error.message
            : '저장하지 못했습니다.',
      });
    } finally {
      setBusy(false);
      rerender();
    }
  };

  const tools: { id: Tool; icon: ComponentType<{ color: string; size: number }>; label: string }[] =
    [
      { id: 'pencil', icon: Pencil, label: '연필' },
      { id: 'eraser', icon: Eraser, label: '지우개' },
      { id: 'fill', icon: PaintBucket, label: '채우기' },
      { id: 'pick', icon: Pipette, label: '스포이트' },
    ];

  return (
    <View style={[styles.root, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
      {/* 머리글: 닫기, 이름, 되돌리기, 저장 */}
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <IconButton icon={X} label="에디터 닫기" onPress={close} />
        <TextInput
          value={doc.name}
          onChangeText={(name) => editor.setName(name)}
          maxLength={40}
          style={[styles.name, { color: theme.fg, backgroundColor: theme.bgInput }]}
          accessibilityLabel={`${KIND_LABEL[doc.kind]} 이름`}
        />
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
        <IconButton
          icon={SlidersHorizontal}
          label={`${KIND_LABEL[doc.kind]} 설정`}
          onPress={() => setOptionsOpen(true)}
        />
        <Pressable
          onPress={() => void save()}
          disabled={busy || missing.length > 0 || !doc.name.trim()}
          accessibilityRole="button"
          accessibilityLabel="저장"
          style={[
            styles.save,
            {
              backgroundColor: theme.accent,
              opacity: busy || missing.length > 0 || !doc.name.trim() ? 0.5 : 1,
            },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={theme.accentFg} />
          ) : (
            <Save color={theme.accentFg} size={18} />
          )}
        </Pressable>
      </View>
      {(status || missing.length > 0 || editor.dirty) && (
        <Text
          style={[
            styles.status,
            {
              color: status
                ? status.ok
                  ? theme.ok
                  : theme.danger
                : missing.length
                  ? theme.warn
                  : theme.muted,
            },
          ]}
          numberOfLines={2}
        >
          {status?.text ??
            (missing.length > 0
              ? `저장하려면 그려야 합니다: ${missing.map((m) => ANIMATION_LABEL.get(m.name) ?? m.name).join(', ')}`
              : '저장하지 않은 변경이 있습니다.')}
        </Text>
      )}

      {/* 그림판 + 미리보기 */}
      <View style={styles.stage}>
        <EditorCanvas
          image={image}
          onion={onion}
          width={doc.width}
          height={doc.height}
          grid={doc.kind !== 'character'}
          footprint={
            doc.kind === 'object' && tool === 'footprint'
              ? { columns: Math.round(doc.width / 16), cells: doc.footprint }
              : null
          }
          onStroke={onStroke}
        />
        <View style={[styles.preview, { backgroundColor: theme.bg, borderColor: theme.border }]}>
          <AnimationPreview animation={animation} doc={doc} images={images} />
        </View>
      </View>

      {/* 도구 */}
      <View style={[styles.tools, { borderTopColor: theme.border }]}>
        {tools.map((t) => (
          <ToolButton
            key={t.id}
            icon={t.icon}
            label={t.label}
            active={tool === t.id}
            onPress={() => setTool(t.id)}
          />
        ))}
        <ToolButton
          icon={FlipHorizontal2}
          label="좌우 대칭"
          active={mirror}
          onPress={() => setMirror((v) => !v)}
        />
        <ToolButton
          icon={Layers}
          label="앞 프레임 겹쳐 보기"
          active={onionOn}
          onPress={() => setOnionOn((v) => !v)}
        />
        <Pressable
          onPress={() => setBrush(BRUSHES[(BRUSHES.indexOf(brush) + 1) % BRUSHES.length]!)}
          accessibilityRole="button"
          accessibilityLabel={`붓 굵기 ${brush}`}
          style={[styles.tool, { backgroundColor: theme.bgInput }]}
        >
          <Text style={{ color: theme.fg, fontWeight: '700' }}>{brush}px</Text>
        </Pressable>
      </View>

      {/* 팔레트 */}
      <ScrollView
        horizontal
        style={styles.paletteScroll}
        contentContainerStyle={styles.palette}
        showsHorizontalScrollIndicator={false}
      >
        {doc.palette.map((hex, i) => {
          const value = i + 1;
          const active = value === safeColor && tool !== 'eraser';
          return (
            <Pressable
              key={`${i}:${hex}`}
              onPress={() => {
                setColor(value);
                if (tool === 'eraser' || tool === 'pick' || tool === 'footprint') setTool('pencil');
              }}
              onLongPress={() => setColorEdit({ value })}
              accessibilityRole="button"
              accessibilityLabel={`색 ${hex}`}
              accessibilityState={{ selected: active }}
              style={[
                styles.swatch,
                { backgroundColor: hex, borderColor: active ? theme.fg : theme.border },
                active && styles.swatchActive,
              ]}
            />
          );
        })}
        <Pressable
          onPress={() => setColorEdit({ value: null })}
          accessibilityRole="button"
          accessibilityLabel="색 더하기"
          style={[styles.swatch, styles.addColor, { borderColor: theme.border }]}
        >
          <Plus color={theme.muted} size={18} />
        </Pressable>
      </ScrollView>

      {/* 애니메이션과 프레임 */}
      <View
        style={[styles.frames, { borderTopColor: theme.border, paddingBottom: insets.bottom + 8 }]}
      >
        <Pressable
          onPress={() => setAnimationsOpen(true)}
          style={[styles.animation, { backgroundColor: theme.bgInput }]}
          accessibilityRole="button"
          accessibilityLabel="애니메이션 고르기"
        >
          <Text style={{ color: theme.fg, fontWeight: '600' }} numberOfLines={1}>
            {animationLabel(animation)}
          </Text>
          <Text style={{ color: theme.muted, fontSize: 12 }}>
            {frameIndex + 1}/{animation.frames.length}
          </Text>
        </Pressable>
        <IconButton icon={ChevronLeft} label="앞 프레임" onPress={() => goFrame(-1)} />
        <IconButton icon={ChevronRight} label="다음 프레임" onPress={() => goFrame(1)} />
        <IconButton icon={Plus} label="빈 프레임 넣기" onPress={() => addFrame(false)} />
        <IconButton icon={Copy} label="이 프레임 복제" onPress={() => addFrame(true)} />
        <IconButton
          icon={Trash2}
          label="이 프레임 지우기"
          disabled={animation.frames.length <= 1}
          onPress={removeFrame}
        />
      </View>

      {colorEdit && (
        <ColorSheet
          initial={colorEdit.value ? doc.palette[colorEdit.value - 1]! : null}
          canRemove={colorEdit.value !== null && doc.palette.length > 1}
          onClose={() => setColorEdit(null)}
          onApply={(hex) => {
            if (colorEdit.value) editor.setColor(colorEdit.value, hex);
            else {
              const value = editor.addColor(hex);
              if (value) setColor(value);
            }
            setColorEdit(null);
          }}
          onRemove={() => {
            if (colorEdit.value) editor.removeColor(colorEdit.value);
            setColorEdit(null);
          }}
        />
      )}

      <Sheet visible={animationsOpen} title="애니메이션" onClose={() => setAnimationsOpen(false)}>
        <ScrollView style={{ maxHeight: 420 }}>
          {doc.animations.map((a, i) => {
            const incomplete = missing.some((m) => m.name === a.name);
            return (
              <Pressable
                key={a.name}
                onPress={() => {
                  setRef({ animation: i, frame: 0 });
                  setAnimationsOpen(false);
                }}
                style={({ pressed }) => [
                  styles.animationRow,
                  (pressed || i === current.animation) && { backgroundColor: theme.bgHover },
                ]}
              >
                <Text style={{ flex: 1, color: theme.fg, fontSize: 15 }}>{animationLabel(a)}</Text>
                {incomplete && <Text style={{ color: theme.warn, fontSize: 12 }}>그려야 함</Text>}
                <Text style={{ color: theme.muted, fontSize: 12 }}>{a.frames.length}장</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={styles.speedRow}>
          <Text style={{ color: theme.muted, flex: 1 }}>프레임 간격 {animation.frameMs}ms</Text>
          <IconButton
            icon={ChevronLeft}
            label="빠르게"
            disabled={animation.frameMs <= 40}
            onPress={() =>
              editor.setFrameMs(current.animation, Math.max(40, animation.frameMs - 20))
            }
          />
          <IconButton
            icon={ChevronRight}
            label="느리게"
            disabled={animation.frameMs >= 2000}
            onPress={() =>
              editor.setFrameMs(current.animation, Math.min(2000, animation.frameMs + 20))
            }
          />
        </View>
      </Sheet>

      <Sheet
        visible={optionsOpen}
        title={`${KIND_LABEL[doc.kind]} 설정`}
        onClose={() => setOptionsOpen(false)}
      >
        {doc.kind === 'tile' && (
          <>
            <SwitchRow
              label="지나갈 수 없음 (탑다운: 벽, 횡스크롤: 땅)"
              value={doc.solid}
              onChange={(v) => editor.setSolid(v)}
            />
            <SwitchRow
              label="발판 (횡스크롤: 위에서만 딛음)"
              value={doc.platform}
              onChange={(v) => editor.setPlatform(v)}
            />
          </>
        )}
        {doc.kind === 'object' && (
          <>
            <Text style={{ color: theme.muted }}>
              막힌 칸 고르기를 켜고 그림판의 칸을 누르면 그 칸을 막거나 엽니다 (빨간 칸 = 지나갈 수
              없음).
            </Text>
            <SwitchRow
              label="막힌 칸 고르기"
              value={tool === 'footprint'}
              onChange={(v) => {
                setTool(v ? 'footprint' : 'pencil');
                setOptionsOpen(false);
              }}
            />
          </>
        )}
        {doc.kind === 'character' && (
          <>
            <Text style={{ color: theme.muted, fontSize: 12, fontWeight: '700' }}>광장 방식</Text>
            <Segmented<PlazaStyle>
              value={doc.style}
              onChange={(style) => editor.setStyle(style)}
              options={[
                { value: PlazaStyle.TopDown, label: '탑다운용' },
                { value: PlazaStyle.SideScroll, label: '횡스크롤용' },
              ]}
            />
            <Text style={{ color: theme.muted, fontSize: 12 }}>
              횡스크롤용은 오른쪽을 보는 대기·걷기·점프만 그리면 됩니다 (왼쪽은 좌우 반전).
            </Text>
            <Text style={{ color: theme.muted, fontSize: 12, fontWeight: '700' }}>
              광장에서의 키: {doc.plazaHeight}타일
            </Text>
            <View style={styles.heights}>
              {CHARACTER_PLAZA_HEIGHTS.map((h) => (
                <Pressable
                  key={h}
                  onPress={() => editor.setPlazaHeight(h)}
                  style={[
                    styles.height,
                    {
                      backgroundColor: h === doc.plazaHeight ? theme.accent : theme.bgInput,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: h === doc.plazaHeight ? theme.accentFg : theme.fg,
                      fontSize: 13,
                    }}
                  >
                    {h}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
      </Sheet>
    </View>
  );
}

/** 지금 애니메이션을 되풀이해 트는 작은 미리보기 */
function AnimationPreview({
  animation,
  doc,
  images,
}: {
  animation: EditorAnimation;
  doc: EditorDoc;
  images: EditorFrameImages;
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), animation.frameMs);
    return () => clearInterval(timer);
  }, [animation.frameMs]);
  const pixels = animation.frames[tick % animation.frames.length]!;
  const image = images.image(pixels, doc.width, doc.height, doc.palette);
  const box = 64;
  const scale = box / Math.max(doc.width, doc.height);
  const w = doc.width * scale;
  const h = doc.height * scale;
  return (
    <Canvas style={{ width: box, height: box }}>
      {image && (
        <Image
          image={image}
          x={(box - w) / 2}
          y={box - h}
          width={w}
          height={h}
          sampling={{
            filter: scale < 1 ? FilterMode.Linear : FilterMode.Nearest,
            mipmap: MipmapMode.None,
          }}
        />
      )}
    </Canvas>
  );
}

function IconButton({
  icon: Icon,
  label,
  disabled,
  onPress,
}: {
  icon: ComponentType<{ color: string; size: number }>;
  label: string;
  disabled?: boolean;
  onPress(): void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.icon,
        { opacity: disabled ? 0.35 : 1 },
        pressed && { backgroundColor: theme.bgHover },
      ]}
    >
      <Icon color={theme.fg} size={20} />
    </Pressable>
  );
}

function ToolButton({
  icon: Icon,
  label,
  active,
  onPress,
}: {
  icon: ComponentType<{ color: string; size: number }>;
  label: string;
  active: boolean;
  onPress(): void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={[styles.tool, { backgroundColor: active ? theme.accent : theme.bgInput }]}
    >
      <Icon color={active ? theme.accentFg : theme.fg} size={20} />
    </Pressable>
  );
}

function SwitchRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange(value: boolean): void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.switchRow}>
      <Text style={{ flex: 1, color: theme.fg }}>{label}</Text>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, zIndex: 10 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  name: { flex: 1, minHeight: 38, borderRadius: 8, paddingHorizontal: 10, fontSize: 15 },
  save: {
    width: 42,
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  status: { fontSize: 12, paddingHorizontal: 12, paddingVertical: 4 },
  stage: { flex: 1 },
  preview: {
    position: 'absolute',
    right: 8,
    top: 8,
    padding: 4,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tools: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tool: { flex: 1, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  // 가로 ScrollView는 기본이 flexGrow: 1이라 남는 높이를 가져간다
  paletteScroll: { flexGrow: 0 },
  palette: { gap: 8, paddingHorizontal: 10, paddingVertical: 10, alignItems: 'center' },
  swatch: { width: 32, height: 32, borderRadius: 8, borderWidth: 2 },
  swatchActive: { transform: [{ scale: 1.15 }] },
  addColor: { alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed' },
  frames: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  animation: { flex: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  icon: { width: 40, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  animationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 46,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  speedRow: { flexDirection: 'row', alignItems: 'center' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  heights: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  height: {
    minWidth: 40,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: 'center',
  },
});
