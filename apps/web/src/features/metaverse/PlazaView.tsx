import {
  type AssetDto,
  type MessageDto,
  type PlazaCorrection,
  type PlazaId,
  type PlazaMemberChange,
  type PlazaMotionChanged,
  type PlazaMoved,
  PlazaStyle,
  SocketEvent,
  type UserProfile,
  characterFor,
  characterMotions,
  isBuiltinRef,
  mapStyle,
  messagePresentation,
} from '@metacode/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Phaser from 'phaser';
import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Repeat2, Sparkles } from 'lucide-react';
import { apiFetch } from '../../api/client';
import { useRealtime } from '../../realtime/RealtimeProvider';
import {
  displayName,
  markdownToPlain,
  EMOTE_DURATION_MS,
  bubbleDurationMs,
  bubbleText,
  emoteLabel,
} from '@metacode/client';
import { useVoiceStore } from '../voice/store';
import { requestPanelFocus } from '../../layout/panelFocus';
import { PlazaScene } from './PlazaScene';
import { type VoiceLabel, plazaVoiceStates } from './plazaVoice';

const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
/** 횡스크롤은 Space로도 뛴다 */
const SIDE_KEYS = new Set([...ARROW_KEYS, ' ']);

/** Ctrl +/−로 바꾼 배율 단계 (광장을 다시 열어도 그대로) */
const ZOOM_KEY = 'metacode:plaza-zoom';
/** 배율을 바꾸면 잠깐 보이는 표시 */
const ZOOM_TOAST_MS = 1200;
/** 트랙패드를 모아 벌리기(Ctrl+휠)는 조금씩 여러 번 오므로 이만큼 모이면 한 단계 */
const WHEEL_STEP = 60;

function readZoomOffset(): number {
  try {
    return Number(localStorage.getItem(ZOOM_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveZoomOffset(offset: number): void {
  try {
    localStorage.setItem(ZOOM_KEY, String(offset));
  } catch {
    // 기억하지 못해도 이번에는 바뀐 배율로 보인다.
  }
}

/** Ctrl(맥은 Cmd) + / − (숫자 자판의 +, −도). 자판 배열과 상관없이 자리(code)로도 본다 */
function zoomStepOf(e: KeyboardEvent): 1 | -1 | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  if (e.key === '+' || e.key === '=' || e.code === 'Equal' || e.code === 'NumpadAdd') return 1;
  if (e.key === '-' || e.key === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract') {
    return -1;
  }
  return null;
}

/** 숫자 키 (모션). 한글 자판에서도 되도록 자리(code)로 본다 */
function digitOf(e: KeyboardEvent): string | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return null;
  const match = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
  return match ? match[1]! : /^\d$/.test(e.key) ? e.key : null;
}

export interface PlazaViewProps {
  plazaId: PlazaId;
  me: UserProfile;
  /**
   * 말풍선을 띄울 채널과 그 이름표. 분수 광장은 커뮤니티의 텍스트 채널 전부('#일반' 등),
   * 모닥불 캠프는 그 DM 하나(이름표 없음). 여기 없는 채널의 메시지는 띄우지 않는다.
   */
  channelLabels: ReadonlyMap<string, string | null>;
  /** 이 광장에 속한 통화 채널과 캐릭터에 보일 이름 (음성 채널 '🔊 lounge', DM '📞 통화 중') */
  voiceLabels: ReadonlyMap<string, VoiceLabel>;
}

/**
 * 메타버스 모드: 광장 하나. Phaser 게임을 띄우고, 서버의 광장 이벤트와 메시지를 씬에 넣는다.
 * 방향키는 이 패널에 포커스가 있을 때만 캐릭터를 움직인다 (채팅 입력 중에는 움직이지 않는다).
 */
export default function PlazaView({ plazaId, me, channelLabels, voiceLabels }: PlazaViewProps) {
  const { socket } = useRealtime();
  const queryClient = useQueryClient();
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<PlazaScene | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [focused, setFocused] = useState(false);
  const [style, setStyle] = useState<PlazaStyle>(PlazaStyle.TopDown);
  const side = style === PlazaStyle.SideScroll;
  const [zoomToast, setZoomToast] = useState<number | null>(null);
  const [motionsOpen, setMotionsOpen] = useState(false);
  const motions = useMyMotions(me, style);

  // 씬이 보내는 이동은 항상 최신 연결로 보낸다.
  const socketRef = useRef(socket);
  const labelsRef = useRef(channelLabels);
  const voiceLabelsRef = useRef(voiceLabels);
  useLayoutEffect(() => {
    socketRef.current = socket;
    labelsRef.current = channelLabels;
    voiceLabelsRef.current = voiceLabels;
  });

  // Phaser 게임: 광장마다 하나 (부모가 plazaId로 key를 준다)
  useEffect(() => {
    const overlay = overlayRef.current!;
    const created = new PlazaScene({
      meId: me.id,
      overlay,
      nameOf: displayName,
      onMove: (state) => socketRef.current?.emit(SocketEvent.PlazaMove, { plazaId, ...state }),
      onMotion: (motion, loop) =>
        socketRef.current?.emit(SocketEvent.PlazaSetMotion, { plazaId, motion, loop }),
      zoomOffset: readZoomOffset(),
    });
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: stageRef.current!,
      backgroundColor: '#11161d',
      pixelArt: true,
      roundPixels: true,
      banner: false,
      audio: { noAudio: true },
      // 키보드는 직접 받는다 (포커스가 있을 때만). Phaser는 창 전체의 키를 가로챈다.
      input: { keyboard: false },
      scale: { mode: Phaser.Scale.RESIZE },
      scene: created,
    });
    let cancelled = false;
    void created.ready.then(() => {
      if (!cancelled) setScene(created);
    });
    // Phaser의 RESIZE는 창 크기만 보고 패널 크기가 바뀐 것(구분선 끌기, 패널 옮기기)은 모른다.
    // 그대로 두면 캔버스가 예전 크기로 남아 광장 일부가 비어 보였다.
    // (RESIZE 모드는 기억해 둔 부모 크기로 캔버스를 다시 맞추므로, 부모 크기를 먼저 다시 읽게 한다.)
    const observer = new ResizeObserver(() => {
      if (!game.isBooted) return;
      game.scale.getParentBounds();
      game.scale.refresh();
    });
    observer.observe(stageRef.current!);
    return () => {
      observer.disconnect();
      cancelled = true;
      setScene(null);
      game.destroy(true);
      overlay.replaceChildren();
    };
  }, [me.id, plazaId]);

  // 광장 열기와 인원, 이동 동기화. 다시 연결되면 광장을 다시 연다 (서버의 방 참여가 끊기므로).
  useEffect(() => {
    if (!scene || !socket) return;
    /**
     * 직접 그린 캐릭터는 에셋을 받아 와서 씬에 등록한 뒤 다시 그린다. 받기 전에는 기본 캐릭터로 보인다.
     * 같은 에셋·같은 버전은 한 번만 받는다.
     */
    const loadCharacters = (users: UserProfile[]) => {
      for (const user of users) {
        // 이 광장 방식에서 보일 캐릭터 (횡스크롤은 따로 고른 캐릭터일 수 있다)
        const character = characterFor(user, scene.plazaStyle);
        if (!character || isBuiltinRef(character.asset)) continue;
        void queryClient
          .fetchQuery({
            queryKey: ['assets', 'one', character.asset, character.version ?? ''],
            queryFn: () => apiFetch<AssetDto>(`/assets/${character.asset}`),
            staleTime: Infinity,
          })
          .then((asset) => {
            scene.addAsset(asset.id, asset.manifest);
            scene.updateUser(user);
          })
          .catch(() => {});
      }
    };
    /** 맵에 쓴 커뮤니티 에셋(타일·오브젝트)을 받아 씬에 등록한다. 같은 에셋·버전은 한 번만 받는다 */
    const loadMapAssets = (assets: { id: string; version: string }[]) =>
      Promise.all(
        assets.map(({ id, version }) =>
          queryClient
            .fetchQuery({
              queryKey: ['assets', 'one', id, version],
              queryFn: () => apiFetch<AssetDto>(`/assets/${id}`),
              staleTime: Infinity,
            })
            .then((asset) => scene.addAsset(asset.id, asset.manifest))
            .catch(() => {}),
        ),
      );
    let latestWatch = 0;
    const watch = () => {
      const request = ++latestWatch;
      socket.emit(SocketEvent.PlazaWatch, { plazaId }, (ack) => {
        if (!ack.ok) return setStatus('error');
        void loadMapAssets(ack.data.assets).then(() => {
          // 받는 사이에 맵이 또 바뀌어 다시 열었으면 앞의 결과는 버린다.
          if (request !== latestWatch) return;
          scene.applySnapshot(ack.data);
          loadCharacters(ack.data.occupants.map((o) => o.user));
          setStyle(mapStyle(ack.data.definition));
          setStatus('ready');
        });
      });
    };
    const onMapChanged = (event: { plazaId: PlazaId }) => {
      if (event.plazaId === plazaId) watch();
    };
    const onMoved = (event: PlazaMoved) => {
      if (event.plazaId === plazaId) scene.moved(event);
    };
    const onMember = (change: PlazaMemberChange) => {
      if (change.plazaId !== plazaId) return;
      if (change.occupant) {
        scene.upsert(change.occupant);
        loadCharacters([change.occupant.user]);
      } else {
        scene.remove(change.userId);
      }
    };
    const onCorrected = (correction: PlazaCorrection) => {
      if (correction.plazaId === plazaId) scene.corrected(correction);
    };
    const onMotion = (event: PlazaMotionChanged) => {
      if (event.plazaId === plazaId) scene.setMotion(event.userId, event.motion, event.loop);
    };
    // 메시지 하나가 채팅 모드와 광장 모두에 보인다 (메타버스 전용 메시지는 없다).
    const onMessage = (message: MessageDto) => {
      const labels = labelsRef.current;
      if (!labels.has(message.channelId)) return;
      const kind = messagePresentation(message);
      // 말풍선은 마크다운 기호를 빼고 보여 준다 (스포일러는 가림).
      const emote = kind === 'bubble' ? null : emoteLabel(message.attachments);
      const text = emote ? emote.text : bubbleText(markdownToPlain(message.content));
      if (!text) return;
      const duration = kind === 'bubble' ? bubbleDurationMs(text) : EMOTE_DURATION_MS;
      scene.say(message.author.id, {
        id: message.id,
        label: labels.get(message.channelId) ?? null,
        text,
        kind,
        icon: emote?.icon,
        expiresAt: performance.now() + duration,
      });
    };

    // 고치거나 지운 메시지는 광장의 말풍선에도 바로 반영한다 (채팅 모드와 같은 메시지).
    const onMessageUpdated = (message: MessageDto) => {
      if (!labelsRef.current.has(message.channelId)) return;
      if (messagePresentation(message) !== 'bubble') return;
      scene.editBubble(message.id, bubbleText(markdownToPlain(message.content)));
    };
    const onMessageDeleted = ({ messageId }: { messageId: string }) =>
      scene.removeBubble(messageId);

    const onUserUpdated = (user: UserProfile) => {
      scene.updateUser(user);
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
    };
  }, [scene, socket, plazaId, queryClient]);

  // 통화 상태 → 캐릭터 위 음성 채널 표시와 말하는 중 고리
  const calls = useVoiceStore((s) => s.calls);
  const myCallId = useVoiceStore((s) => s.session?.channelId ?? null);
  const voiceKey = JSON.stringify([...voiceLabels]);
  useEffect(() => {
    // voiceLabels는 렌더마다 새로 만들어지므로 내용(voiceKey)이 바뀔 때만 다시 계산한다.
    scene?.setVoice(plazaVoiceStates(calls, voiceLabelsRef.current, myCallId));
  }, [scene, calls, voiceKey, myCallId]);

  // 배율 표시는 잠깐만 보인다.
  useEffect(() => {
    if (zoomToast === null) return;
    const timer = setTimeout(() => setZoomToast(null), ZOOM_TOAST_MS);
    return () => clearTimeout(timer);
  }, [zoomToast]);

  const zoom = (step: 1 | -1) => {
    const result = scene?.zoomBy(step);
    if (!result) return;
    saveZoomOffset(result.offset);
    setZoomToast(result.zoom);
  };

  // Ctrl+휠(트랙패드 모아 벌리기)도 배율을 바꾼다. 브라우저 확대를 막으려면 passive가 아니어야 해서 직접 건다.
  const zoomRef = useRef(zoom);
  useLayoutEffect(() => {
    zoomRef.current = zoom;
  });
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let wheel = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      wheel += e.deltaY;
      if (Math.abs(wheel) < WHEEL_STEP) return;
      zoomRef.current(wheel < 0 ? 1 : -1);
      wheel = 0;
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, []);

  // 창이 포커스를 잃으면 keyup을 못 받으므로 눌린 키를 비운다.
  useEffect(() => {
    if (!scene) return;
    const release = () => scene.releaseAll();
    window.addEventListener('blur', release);
    return () => window.removeEventListener('blur', release);
  }, [scene]);

  const onKeyDown = (e: KeyboardEvent) => {
    // Ctrl +/−: 광장 배율 (브라우저 확대 대신)
    const step = zoomStepOf(e);
    if (step) {
      e.preventDefault();
      zoom(step);
      return;
    }
    // 숫자 키: 캐릭터 모션
    const digit = digitOf(e);
    if (digit && !e.repeat && scene?.playMotion(digit)) {
      e.preventDefault();
      return;
    }
    // /는 채팅 입력창으로 (게임처럼 바로 말하기). 한글 자판에서도 되도록 자리(code)로도 본다.
    if (
      (e.key === '/' || e.code === 'Slash') &&
      !e.shiftKey &&
      !e.altKey &&
      !e.ctrlKey &&
      !e.metaKey
    ) {
      e.preventDefault();
      scene?.releaseAll();
      // 메시지를 보내면(또는 Esc) 광장으로 돌아온다.
      requestPanelFocus('chat', 'plaza');
      return;
    }
    if (!(side ? SIDE_KEYS : ARROW_KEYS).has(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    // 누르고 있어서 반복되는 keydown은 새로 누른 것이 아니다 (점프가 계속 이어지지 않게).
    if (e.repeat) return;
    scene?.press(e.key);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    scene?.release(e.key);
  };

  return (
    <div
      ref={hostRef}
      className="plaza"
      tabIndex={0}
      role="application"
      aria-label={
        side
          ? '광장. 좌우 방향키로 걷고 위쪽 방향키나 스페이스로 뜁니다. 아래쪽 방향키로 발판에서 내려갑니다.'
          : '광장. 방향키로 움직이고, 가고 싶은 곳을 누르면 걸어갑니다.'
      }
      data-focused={focused}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        scene?.releaseAll();
      }}
      // 캔버스를 누르면 광장에 포커스를 준다 (Phaser가 기본 동작을 막아서 직접 준다).
      onPointerDown={() => hostRef.current?.focus({ preventScroll: true })}
    >
      <div ref={stageRef} className="plaza__stage" />
      <div ref={overlayRef} className="plaza__overlay" aria-hidden />
      {status !== 'ready' && (
        <p className="plaza__status" role={status === 'error' ? 'alert' : 'status'}>
          {status === 'error' ? '광장을 열지 못했습니다.' : '광장으로 가는 중…'}
        </p>
      )}
      {status === 'ready' && !focused && (
        <p className="plaza__hint">
          광장을 누르면 방향키로 움직일 수 있어요 · Shift+Tab으로 오가기
        </p>
      )}
      {status === 'ready' && focused && (
        <p className="plaza__hint">
          {side ? '←→ 걷기 · Space 점프 · ↓ 내려가기 · ' : ''}
          {motions.length > 0 ? '숫자 키 모션 · ' : ''}/ 를 누르면 바로 채팅
        </p>
      )}
      {zoomToast !== null && (
        <p className="plaza__zoom" role="status">
          ×{zoomToast}
        </p>
      )}
      {status === 'ready' && motions.length > 0 && (
        <div className="plaza-motions" onPointerDown={(e) => e.stopPropagation()}>
          {motionsOpen && (
            <ul className="plaza-motions__list" aria-label="모션">
              {motions.map((motion) => (
                <li key={motion.name}>
                  <button
                    type="button"
                    onClick={() => {
                      scene?.playMotion(motion.key);
                      hostRef.current?.focus({ preventScroll: true });
                    }}
                  >
                    <kbd>{motion.key}</kbd>
                    <span>{motion.label}</span>
                    {motion.loop && <Repeat2 role="img" aria-label="반복" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="plaza-motions__toggle"
            aria-expanded={motionsOpen}
            aria-label="모션"
            title="모션 (숫자 키)"
            onClick={() => setMotionsOpen((v) => !v)}
          >
            <Sparkles aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * 내 캐릭터의 모션 (숫자 키). 직접 그린 캐릭터에 추가한 것만 있고, 광장이 받아 둔 것과 같은 캐시로 받는다.
 */
function useMyMotions(me: UserProfile, style: PlazaStyle) {
  const character = characterFor(me, style);
  const custom = !!character && !isBuiltinRef(character.asset);
  const asset = useQuery({
    queryKey: ['assets', 'one', character?.asset ?? '', character?.version ?? ''],
    queryFn: () => apiFetch<AssetDto>(`/assets/${character!.asset}`),
    enabled: custom,
    staleTime: Infinity,
  });
  return custom && asset.data ? characterMotions(asset.data.manifest) : [];
}
