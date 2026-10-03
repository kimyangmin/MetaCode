import type { PlazaWorld } from '@metacode/client';
import { type PlazaId, type UserProfile, inputKeyLabel } from '@metacode/shared';
import { Canvas, Picture, type SkPicture } from '@shopify/react-native-skia';
import { useQueryClient } from '@tanstack/react-query';
import { Repeat2, Sparkles } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSharedValue } from 'react-native-reanimated';
import { useRealtime } from '../../realtime/RealtimeProvider';
import { useTheme } from '../../ui/theme';
import { PlazaControls } from './Controls';
import { PlazaEngine, emptyPicture } from './engine';
import { type ActorLabel, ActorOverlay, type Heads } from './Overlay';

/** 배율을 바꾸면 잠깐 보이는 표시 */
const ZOOM_TOAST_MS = 1200;

/**
 * 메타버스 모드: 광장 하나 (웹 PlazaView의 네이티브판). 서버 이벤트와 그리기는 PlazaEngine이 하고, 여기서는
 * Skia 캔버스·이름표·조작 버튼을 놓는다. 누른 곳으로 걷고, 조이스틱으로 움직이고, 두 손가락으로 배율을 바꾼다.
 */
export function PlazaView({
  plazaId,
  me,
  channelLabels,
}: {
  plazaId: PlazaId;
  me: UserProfile;
  /**
   * 말풍선을 띄울 채널과 그 이름표. 분수 광장은 커뮤니티의 텍스트 채널 전부('#일반' 등),
   * 모닥불 캠프는 그 DM 하나(이름표 없음).
   */
  channelLabels: ReadonlyMap<string, string | null>;
}) {
  const theme = useTheme();
  const { socket } = useRealtime();
  const queryClient = useQueryClient();
  // 광장마다 하나 (부모가 plazaId로 key를 준다)
  const [engine] = useState(() => new PlazaEngine(me.id, plazaId));
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [side, setSide] = useState(false);
  const [labels, setLabels] = useState<ActorLabel[]>([]);
  const [motions, setMotions] = useState<ReturnType<PlazaWorld['myMotions']>>([]);
  const [motionsOpen, setMotionsOpen] = useState(false);
  const [zoomToast, setZoomToast] = useState<number | null>(null);
  const picture = useSharedValue<SkPicture>(emptyPicture());
  const heads = useSharedValue<Heads>({});
  const viewWidth = useSharedValue(0);

  useEffect(() => {
    engine.setChannelLabels(channelLabels);
  }, [engine, channelLabels]);

  useEffect(
    () =>
      engine.start({
        picture: (p) => picture.set(p),
        heads: (h) => heads.set(h),
        labels: setLabels,
        motions: setMotions,
      }),
    [engine, picture, heads],
  );

  useEffect(() => {
    if (!socket) return;
    return engine.connect(socket, queryClient, ({ ok, side: isSide }) => {
      setStatus(ok ? 'ready' : 'error');
      setSide(isSide);
    });
  }, [engine, socket, queryClient]);

  useEffect(() => {
    if (zoomToast === null) return;
    const timer = setTimeout(() => setZoomToast(null), ZOOM_TOAST_MS);
    return () => clearTimeout(timer);
  }, [zoomToast]);

  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd((e, success) => {
      if (success) engine.walkAt(e.x, e.y);
    });
  const pinch = Gesture.Pinch()
    .runOnJS(true)
    .onBegin(() => engine.pinchBegin())
    .onUpdate((e) => {
      const zoom = engine.pinchUpdate(e.scale);
      if (zoom !== null) setZoomToast(zoom);
    });
  const gestures = Gesture.Exclusive(pinch, tap);

  return (
    <View
      style={styles.root}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        engine.resize(width, height);
        viewWidth.set(width);
      }}
    >
      <GestureDetector gesture={gestures}>
        <Canvas style={StyleSheet.absoluteFill}>
          <Picture picture={picture} />
        </Canvas>
      </GestureDetector>
      <ActorOverlay labels={labels} heads={heads} viewWidth={viewWidth} />
      {status === 'ready' && (
        <PlazaControls
          side={side}
          onStick={(dx, dy) => engine.stick(dx, dy)}
          onJump={(down) => engine.jump(down)}
        />
      )}
      {status === 'ready' && motions.length > 0 && (
        <View style={styles.motions}>
          {motionsOpen && (
            <ScrollView
              style={[styles.motionList, { backgroundColor: theme.bg, borderColor: theme.border }]}
            >
              {motions.map((motion) => (
                <Pressable
                  key={motion.name}
                  // 누르는 동안 켜는 모션은 손가락을 대고 있는 동안만 켠다
                  onPressIn={() => motion.hold && engine.world.playMotion(motion.key)}
                  onPressOut={() => motion.hold && engine.world.releaseMotion(motion.key)}
                  onPress={() => !motion.hold && engine.world.playMotion(motion.key)}
                  style={({ pressed }) => [
                    styles.motion,
                    pressed && { backgroundColor: theme.bgHover },
                  ]}
                >
                  <Text
                    style={[styles.motionKey, { color: theme.muted, borderColor: theme.border }]}
                  >
                    {inputKeyLabel(motion.key)}
                  </Text>
                  <Text style={{ color: theme.fg, flexShrink: 1 }} numberOfLines={1}>
                    {motion.label}
                  </Text>
                  {motion.loop && <Repeat2 color={theme.muted} size={14} />}
                </Pressable>
              ))}
            </ScrollView>
          )}
          <Pressable
            onPress={() => setMotionsOpen((v) => !v)}
            style={styles.motionToggle}
            accessibilityRole="button"
            accessibilityLabel="모션"
            accessibilityState={{ expanded: motionsOpen }}
          >
            <Sparkles color="#fff" size={20} />
          </Pressable>
        </View>
      )}
      {zoomToast !== null && <Text style={styles.zoom}>×{zoomToast}</Text>}
      {status !== 'ready' && (
        <View style={styles.status}>
          {status === 'loading' && <ActivityIndicator color="#fff" />}
          <Text style={styles.statusText}>
            {status === 'loading' ? '광장으로 가는 중…' : '광장을 열지 못했습니다.'}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden', backgroundColor: '#11161d' },
  status: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  statusText: { color: '#fff', fontSize: 14 },
  zoom: {
    position: 'absolute',
    top: 10,
    left: 12,
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    backgroundColor: 'rgba(17,22,29,0.6)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  motions: { position: 'absolute', right: 12, top: 12, alignItems: 'flex-end', gap: 6 },
  motionToggle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(17,22,29,0.5)',
  },
  motionList: { maxHeight: 220, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  motion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 10,
    minWidth: 160,
  },
  motionKey: {
    fontSize: 11,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 4,
    minWidth: 20,
    textAlign: 'center',
  },
});
