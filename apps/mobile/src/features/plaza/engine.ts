import {
  type ActorVoice,
  EMOTE_DURATION_MS,
  NO_CONTROL,
  type PlazaControl,
  PlazaWorld,
  bubbleDurationMs,
  bubbleText,
  displayName,
  emoteLabel,
  manifestId,
  markdownToPlain,
} from '@metacode/client';
import {
  type AssetDto,
  type MessageDto,
  type PlazaCorrection,
  type PlazaId,
  type PlazaMemberChange,
  type PlazaMotionChanged,
  type PlazaMoved,
  SocketEvent,
  type UserProfile,
  characterFor,
  isBuiltinRef,
} from '@metacode/shared';
import { messagePresentation } from '@metacode/shared';
import { builtinAsset } from '@metacode/shared/builtin-assets';
import { Skia, type SkPicture } from '@shopify/react-native-skia';
import type { QueryClient } from '@tanstack/react-query';
import { PixelRatio } from 'react-native';
import { apiFetch } from '../../api/client';
import type { AppSocket } from '../../realtime/RealtimeProvider';
import { FrameImages, type MapScene, buildMapScene } from './images';
import type { ActorLabel, Heads } from './Overlay';
import { type PlazaArt, type PlazaView, createPlazaArt, drawPlaza } from './render';

/** 두 손가락을 이만큼 벌리거나 모으면 배율 한 단계 */
const PINCH_STEP = 1.25;
/** 사용자가 바꾼 배율 단계 (앱을 켜 둔 동안 광장을 다시 열어도 그대로) */
let savedZoomOffset = 0;

/** 그리기 결과를 받는 곳 (공유 값, React 상태) */
export interface PlazaSinks {
  picture(picture: SkPicture): void;
  heads(heads: Heads): void;
  /** 이름·말풍선·통화 표시가 바뀌었을 때만 */
  labels(labels: ActorLabel[]): void;
  /** 내 캐릭터의 모션 목록이 바뀌었을 때만 */
  motions(motions: ReturnType<PlazaWorld['myMotions']>): void;
}

export function emptyPicture(): SkPicture {
  const recorder = Skia.PictureRecorder();
  recorder.beginRecording(Skia.XYWHRect(0, 0, 1, 1));
  return recorder.finishRecordingAsPicture();
}

/**
 * 광장 화면 하나의 명령형 부분 (React 밖): PlazaWorld, Skia 그림, 손가락 조작, 서버 이벤트 연결.
 * 화면 컴포넌트는 이것을 한 번 만들어 두고 공유 값·상태만 받는다.
 */
export class PlazaEngine {
  readonly world: PlazaWorld;
  private socket: AppSocket | null = null;
  /** 말풍선을 띄울 채널과 그 이름표 */
  private channelLabels: ReadonlyMap<string, string | null> = new Map();
  private size = { width: 0, height: 0 };
  private readonly control: PlazaControl & { stickDown: boolean } = {
    ...NO_CONTROL,
    stickDown: false,
  };
  private map: MapScene | null = null;
  private images: FrameImages | null = null;
  private art: PlazaArt | null = null;
  private pinchBase = 1;

  constructor(
    meId: string,
    private readonly plazaId: PlazaId,
  ) {
    this.world = new PlazaWorld({
      meId,
      builtinAsset,
      onMove: (state) => this.socket?.emit(SocketEvent.PlazaMove, { plazaId, ...state }),
      onMotion: (motion, loop) =>
        this.socket?.emit(SocketEvent.PlazaSetMotion, { plazaId, motion, loop }),
      zoomOffset: savedZoomOffset,
    });
  }

  setChannelLabels(labels: ReadonlyMap<string, string | null>): void {
    this.channelLabels = labels;
  }

  /** 통화 상태 (참여 중인 음성 채널, 말하는 중) */
  setVoice(states: ReadonlyMap<string, ActorVoice>): void {
    this.world.setVoice(states);
  }

  resize(width: number, height: number): void {
    this.size = { width, height };
    this.world.resize(width, height);
  }

  // ── 그리기 ──

  /** 화면 배율과 카메라. 배율은 실제 픽셀로 정수가 되게 맞춘다 (도트가 고르게 보이게) */
  private camera(): PlazaView {
    const { width, height } = this.size;
    const ratio = PixelRatio.get();
    const scale = Math.max(1, Math.round(this.world.zoom * ratio)) / ratio;
    const center = this.world.cameraCenter(scale);
    const snap = (v: number) => Math.round(v * scale * ratio) / (scale * ratio);
    return {
      width,
      height,
      scale,
      left: snap(center.x - width / scale / 2),
      top: snap(center.y - height / scale / 2),
    };
  }

  /** 프레임마다 그리기를 시작한다. 돌려준 함수로 멈추고 그림을 버린다 */
  start(sinks: PlazaSinks): () => void {
    this.images = new FrameImages();
    this.art = createPlazaArt();
    let frame = 0;
    let last = performance.now();
    let labelKey = '';
    let motionKey = '';
    const world = this.world;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const now = performance.now();
      const delta = now - last;
      last = now;
      if (!this.map || !this.images || !this.art || this.size.width === 0) return;
      world.update(now, delta, this.control);
      this.control.jump = false;
      this.control.drop = false;

      const camera = this.camera();
      const recorder = Skia.PictureRecorder();
      const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, camera.width, camera.height));
      drawPlaza(canvas, world, this.map, this.images, this.art, camera, now);
      sinks.picture(recorder.finishRecordingAsPicture());

      // 이름표 자리 (머리 위). 글이 바뀔 때만 다시 그린다
      const heads: Heads = {};
      const labels: ActorLabel[] = [];
      for (const actor of world.actors.values()) {
        heads[actor.user.id] = {
          x: (actor.position.x - camera.left) * camera.scale,
          y: (actor.position.y - actor.size.height - 1 - camera.top) * camera.scale,
        };
        labels.push({
          id: actor.user.id,
          name: displayName(actor.user),
          isMe: actor.isMe,
          bubbles: actor.bubbles,
          voice: actor.voice,
        });
      }
      sinks.heads(heads);
      const key = JSON.stringify(
        labels.map((l) => [l.id, l.name, l.bubbles.map((b) => [b.id, b.text]), l.voice]),
      );
      if (key !== labelKey) {
        labelKey = key;
        sinks.labels(labels);
      }
      const motions = world.myMotions();
      const nextMotionKey = motions.map((m) => m.key + m.name).join();
      if (nextMotionKey !== motionKey) {
        motionKey = nextMotionKey;
        sinks.motions(motions);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      world.releaseAllMotions();
      world.dispose();
      this.map?.dispose();
      this.images?.dispose();
      this.art?.dispose();
      this.map = null;
      this.images = null;
      this.art = null;
    };
  }

  // ── 서버 ──

  /**
   * 광장 열기와 인원, 이동 동기화. 다시 연결되면 광장을 다시 연다 (서버의 방 참여가 끊기므로).
   * 돌려준 함수로 구독을 끊고 광장을 닫는다.
   */
  connect(
    socket: AppSocket,
    queryClient: QueryClient,
    onReady: (ready: { ok: boolean; side: boolean }) => void,
  ): () => void {
    this.socket = socket;
    const { world, plazaId } = this;
    const fetchAsset = (id: string, version: string) =>
      queryClient.fetchQuery({
        queryKey: ['assets', 'one', id, version],
        queryFn: () => apiFetch<AssetDto>(`/assets/${id}`),
        staleTime: Infinity,
      });
    /** 직접 그린 캐릭터는 받아 와서 등록한 뒤 다시 그린다. 받기 전에는 기본 캐릭터로 보인다 */
    const loadCharacters = (users: UserProfile[]) => {
      for (const user of users) {
        const character = characterFor(user, world.style);
        if (!character || isBuiltinRef(character.asset)) continue;
        void fetchAsset(character.asset, character.version ?? '')
          .then((asset) => {
            world.addAsset(asset.id, asset.manifest);
            world.updateUser(user);
          })
          .catch(() => {});
      }
    };
    let latestWatch = 0;
    const watch = () => {
      const request = ++latestWatch;
      socket.emit(SocketEvent.PlazaWatch, { plazaId }, (ack) => {
        if (!ack.ok) {
          onReady({ ok: false, side: false });
          return;
        }
        void Promise.all(
          ack.data.assets.map(({ id, version }) =>
            fetchAsset(id, version)
              .then((asset) => world.addAsset(asset.id, asset.manifest))
              .catch(() => {}),
          ),
        ).then(() => {
          // 받는 사이에 맵이 또 바뀌어 다시 열었으면 앞의 결과는 버린다.
          if (request !== latestWatch) return;
          const before = world.mapKey;
          world.applySnapshot(ack.data);
          if (world.mapKey !== before || !this.map) {
            this.map?.dispose();
            this.map = buildMapScene(ack.data.definition, world.assetOf, manifestId);
          }
          loadCharacters(ack.data.occupants.map((o) => o.user));
          onReady({ ok: true, side: world.side });
        });
      });
    };
    const onMapChanged = (event: { plazaId: PlazaId }) => {
      if (event.plazaId === plazaId) watch();
    };
    const onMoved = (event: PlazaMoved) => {
      if (event.plazaId === plazaId) world.moved(event);
    };
    const onMember = (change: PlazaMemberChange) => {
      if (change.plazaId !== plazaId) return;
      if (change.occupant) {
        world.upsert(change.occupant);
        loadCharacters([change.occupant.user]);
      } else {
        world.remove(change.userId);
      }
    };
    const onCorrected = (correction: PlazaCorrection) => {
      if (correction.plazaId === plazaId) world.corrected(correction);
    };
    const onMotion = (event: PlazaMotionChanged) => {
      if (event.plazaId === plazaId) world.setMotion(event.userId, event.motion, event.loop);
    };
    // 메시지 하나가 채팅 모드와 광장 모두에 보인다 (메타버스 전용 메시지는 없다).
    const onMessage = (message: MessageDto) => {
      const channels = this.channelLabels;
      if (!channels.has(message.channelId)) return;
      const kind = messagePresentation(message);
      const emote = kind === 'bubble' ? null : emoteLabel(message.attachments);
      const text = emote ? emote.text : bubbleText(markdownToPlain(message.content));
      if (!text) return;
      const duration = kind === 'bubble' ? bubbleDurationMs(text) : EMOTE_DURATION_MS;
      world.say(message.author.id, {
        id: message.id,
        label: channels.get(message.channelId) ?? null,
        text,
        kind,
        icon: emote?.icon,
        expiresAt: performance.now() + duration,
      });
    };
    const onMessageUpdated = (message: MessageDto) => {
      if (!this.channelLabels.has(message.channelId)) return;
      if (messagePresentation(message) !== 'bubble') return;
      world.editBubble(message.id, bubbleText(markdownToPlain(message.content)));
    };
    const onMessageDeleted = ({ messageId }: { messageId: string }) =>
      world.removeBubble(messageId);
    const onUserUpdated = (user: UserProfile) => {
      world.updateUser(user);
      loadCharacters([user]);
    };

    socket.on('connect', watch);
    socket.on(SocketEvent.PlazaMoved, onMoved);
    socket.on(SocketEvent.PlazaMember, onMember);
    socket.on(SocketEvent.PlazaCorrected, onCorrected);
    socket.on(SocketEvent.PlazaMotionChanged, onMotion);
    socket.on(SocketEvent.PlazaMapChanged, onMapChanged);
    socket.on(SocketEvent.MessageCreated, onMessage);
    socket.on(SocketEvent.MessageUpdated, onMessageUpdated);
    socket.on(SocketEvent.MessageDeleted, onMessageDeleted);
    socket.on(SocketEvent.UserUpdated, onUserUpdated);
    if (socket.connected) watch();
    return () => {
      socket.off('connect', watch);
      socket.off(SocketEvent.PlazaMoved, onMoved);
      socket.off(SocketEvent.PlazaMember, onMember);
      socket.off(SocketEvent.PlazaCorrected, onCorrected);
      socket.off(SocketEvent.PlazaMotionChanged, onMotion);
      socket.off(SocketEvent.PlazaMapChanged, onMapChanged);
      socket.off(SocketEvent.MessageCreated, onMessage);
      socket.off(SocketEvent.MessageUpdated, onMessageUpdated);
      socket.off(SocketEvent.MessageDeleted, onMessageDeleted);
      socket.off(SocketEvent.UserUpdated, onUserUpdated);
      if (socket.connected) socket.emit(SocketEvent.PlazaUnwatch, { plazaId });
      if (this.socket === socket) this.socket = null;
    };
  }

  // ── 조작 ──

  /** 누른 곳(화면 dp)으로 걸어간다 */
  walkAt(x: number, y: number): void {
    const camera = this.camera();
    this.world.walkTo({ x: camera.left + x / camera.scale, y: camera.top + y / camera.scale });
  }

  /** 조이스틱 (-1~1). 횡스크롤은 좌우로 걷고, 아래로 깊이 누르면 발판에서 내려간다 (누른 순간 한 번) */
  stick(dx: number, dy: number): void {
    const input = this.control;
    if (this.world.side) {
      input.dx = Math.abs(dx) < 0.3 ? 0 : Math.sign(dx);
      input.dy = 0;
      const down = dy > 0.7 && Math.abs(dx) < 0.5;
      if (down && !input.stickDown) input.drop = true;
      input.stickDown = down;
      return;
    }
    input.dx = dx;
    input.dy = dy;
  }

  /** 점프 버튼을 눌렀다(true) 뗐다(false). 누르고 있으면 높이 뛴다 */
  jump(down: boolean): void {
    const input = this.control;
    if (down && !input.jumpHeld) input.jump = true;
    input.jumpHeld = down;
  }

  pinchBegin(): void {
    this.pinchBase = 1;
  }

  /** 두 손가락 배율: 한 단계 넘게 벌리거나 모았으면 배율을 바꾸고 새 배율을 돌려준다 */
  pinchUpdate(scale: number): number | null {
    const ratio = scale / this.pinchBase;
    if (ratio < PINCH_STEP && ratio > 1 / PINCH_STEP) return null;
    this.pinchBase = scale;
    const result = this.world.zoomBy(ratio >= PINCH_STEP ? 1 : -1);
    if (!result) return null;
    savedZoomOffset = result.offset;
    return result.zoom;
  }
}
