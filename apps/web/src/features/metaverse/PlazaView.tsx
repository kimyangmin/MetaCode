import {
  type MessageDto,
  type PlazaCorrection,
  type PlazaId,
  type PlazaMemberChange,
  type PlazaMoved,
  SocketEvent,
  type UserProfile,
  messagePresentation,
} from '@metacode/shared';
import Phaser from 'phaser';
import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRealtime } from '../../realtime/RealtimeProvider';
import { displayName } from '../../ui/format';
import { useVoiceStore } from '../voice/store';
import { EMOTE_DURATION_MS, bubbleDurationMs, bubbleText, emoteText } from './bubbles';
import { PlazaScene } from './PlazaScene';
import { plazaVoiceStates } from './plazaVoice';

const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export interface PlazaViewProps {
  plazaId: PlazaId;
  me: UserProfile;
  /**
   * 말풍선을 띄울 채널과 그 이름표. 분수 광장은 커뮤니티의 텍스트 채널 전부('#일반' 등),
   * 모닥불 캠프는 그 DM 하나(이름표 없음). 여기 없는 채널의 메시지는 띄우지 않는다.
   */
  channelLabels: ReadonlyMap<string, string | null>;
  /** 이 광장에 속한 통화 채널과 캐릭터에 보일 이름 (음성 채널 '🔊 lounge', DM '📞 통화 중') */
  voiceLabels: ReadonlyMap<string, string>;
}

/**
 * 메타버스 모드: 광장 하나. Phaser 게임을 띄우고, 서버의 광장 이벤트와 메시지를 씬에 넣는다.
 * 방향키는 이 패널에 포커스가 있을 때만 캐릭터를 움직인다 (채팅 입력 중에는 움직이지 않는다).
 */
export default function PlazaView({ plazaId, me, channelLabels, voiceLabels }: PlazaViewProps) {
  const { socket } = useRealtime();
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<PlazaScene | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [focused, setFocused] = useState(false);

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
    return () => {
      cancelled = true;
      setScene(null);
      game.destroy(true);
      overlay.replaceChildren();
    };
  }, [me.id, plazaId]);

  // 광장 열기와 인원, 이동 동기화. 다시 연결되면 광장을 다시 연다 (서버의 방 참여가 끊기므로).
  useEffect(() => {
    if (!scene || !socket) return;
    const watch = () => {
      socket.emit(SocketEvent.PlazaWatch, { plazaId }, (ack) => {
        if (!ack.ok) return setStatus('error');
        scene.applySnapshot(ack.data);
        setStatus('ready');
      });
    };
    const onMoved = (event: PlazaMoved) => {
      if (event.plazaId === plazaId) scene.moved(event);
    };
    const onMember = (change: PlazaMemberChange) => {
      if (change.plazaId !== plazaId) return;
      if (change.occupant) scene.upsert(change.occupant);
      else scene.remove(change.userId);
    };
    const onCorrected = (correction: PlazaCorrection) => {
      if (correction.plazaId === plazaId) scene.corrected(correction);
    };
    // 메시지 하나가 채팅 모드와 광장 모두에 보인다 (메타버스 전용 메시지는 없다).
    const onMessage = (message: MessageDto) => {
      const labels = labelsRef.current;
      if (!labels.has(message.channelId)) return;
      const kind = messagePresentation(message);
      const text = kind === 'bubble' ? bubbleText(message.content) : emoteText(message.attachments);
      if (!text) return;
      const duration = kind === 'bubble' ? bubbleDurationMs(text) : EMOTE_DURATION_MS;
      scene.say(message.author.id, {
        id: message.id,
        label: labels.get(message.channelId) ?? null,
        text,
        kind,
        expiresAt: performance.now() + duration,
      });
    };

    const onUserUpdated = (user: UserProfile) => scene.updateUser(user);

    socket.on('connect', watch);
    socket.on(SocketEvent.PlazaMoved, onMoved);
    socket.on(SocketEvent.PlazaMember, onMember);
    socket.on(SocketEvent.PlazaCorrected, onCorrected);
    socket.on(SocketEvent.MessageCreated, onMessage);
    socket.on(SocketEvent.UserUpdated, onUserUpdated);
    if (socket.connected) watch();
    return () => {
      socket.off('connect', watch);
      socket.off(SocketEvent.PlazaMoved, onMoved);
      socket.off(SocketEvent.PlazaMember, onMember);
      socket.off(SocketEvent.PlazaCorrected, onCorrected);
      socket.off(SocketEvent.MessageCreated, onMessage);
      socket.off(SocketEvent.UserUpdated, onUserUpdated);
      if (socket.connected) socket.emit(SocketEvent.PlazaUnwatch, { plazaId });
    };
  }, [scene, socket, plazaId]);

  // 통화 상태 → 캐릭터 위 음성 채널 표시와 말하는 중 고리
  const calls = useVoiceStore((s) => s.calls);
  const voiceKey = [...voiceLabels].join();
  useEffect(() => {
    // voiceLabels는 렌더마다 새로 만들어지므로 내용(voiceKey)이 바뀔 때만 다시 계산한다.
    scene?.setVoice(plazaVoiceStates(calls, voiceLabelsRef.current));
  }, [scene, calls, voiceKey]);

  // 창이 포커스를 잃으면 keyup을 못 받으므로 눌린 키를 비운다.
  useEffect(() => {
    if (!scene) return;
    const release = () => scene.releaseAll();
    window.addEventListener('blur', release);
    return () => window.removeEventListener('blur', release);
  }, [scene]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (!ARROW_KEYS.has(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
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
      aria-label="광장. 방향키로 움직이고, 가고 싶은 곳을 누르면 걸어갑니다."
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
        <p className="plaza__hint">광장을 누르면 방향키로 움직일 수 있어요</p>
      )}
    </div>
  );
}
