import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type { UserProfile } from '@metacode/shared';
import { Avatar } from '../../ui/Avatar';
import { displayName } from '../../ui/format';
import { openPopupWindow, usePopupWindow } from '../../ui/usePopupWindow';
import {
  type Edge,
  type Frame,
  clampFrame,
  defaultFrame,
  readFrame,
  resizeFrame,
  saveFrame,
} from './floatingFrame';
import { useVoiceStore } from './store';
import { type FullscreenMode, useFullscreen } from './useFullscreen';
import { useVoice } from './VoiceProvider';
import {
  Expand,
  Maximize2,
  MicOff,
  Minimize2,
  PictureInPicture2,
  RotateCw,
  SquareArrowOutUpRight,
  X,
} from 'lucide-react';

const EDGES: Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

/**
 * 화면 공유 보기. 목록의 LIVE를 누르면 화면 위에 떠 있는 창으로 띄운다.
 * 머리글을 끌면 옮기고, 가장자리를 끌면 크기를 바꾸고(위치와 크기는 기억), 분리 버튼을 누르면 별도 창으로 뗀다.
 * 영상은 보고 있는 동안에만 받는다 (닫으면 구독을 끊는다). 소리는 따로 <audio>로 나온다.
 */
export function ScreenViewer() {
  const watching = useVoiceStore((s) => s.watching);
  const session = useVoiceStore((s) => s.session);
  const joining = useVoiceStore((s) => s.watchJoining);
  const failed = useVoiceStore((s) => s.watchError !== null);
  // 보려고 통화에 들어가는 중이거나 들어가지 못했을 때도 창을 띄워 둔다 (누르자마자 반응하도록).
  if (!watching || (!session && !joining && !failed)) return null;
  // 보기를 닫으면 창 부분이 사라지면서 분리해 둔 창도 닫힌다.
  return <ViewerWindow />;
}

/** 이만큼 기다려도 영상이 오지 않으면 다시 시도를 권한다 */
const LOADING_TIMEOUT_MS = 10_000;

/** 보기 창의 상태: 들어가는 중 → 불러오는 중 → 보는 중, 또는 실패·끝남 */
export type ViewerStatus =
  | { kind: 'joining' }
  | { kind: 'loading'; slow: boolean }
  | { kind: 'playing' }
  | { kind: 'ended' }
  | { kind: 'error'; message: string };

export function viewerStatus(state: {
  joining: boolean;
  error: string | null;
  connecting: boolean;
  sharing: boolean;
  stream: boolean;
  slow: boolean;
}): ViewerStatus {
  if (state.error) return { kind: 'error', message: state.error };
  if (state.joining || state.connecting) return { kind: 'joining' };
  if (!state.sharing) return { kind: 'ended' };
  if (!state.stream) return { kind: 'loading', slow: state.slow };
  return { kind: 'playing' };
}

function ViewerWindow() {
  const voice = useVoice();
  const stream = useVoiceStore((s) => s.screen);
  const member = useVoiceStore((s) => {
    const channelId = s.watchChannel ?? s.session?.channelId;
    return channelId && s.watching
      ? s.calls[channelId]?.members.find((m) => m.user.id === s.watching)
      : undefined;
  });
  const joining = useVoiceStore((s) => s.watchJoining);
  const error = useVoiceStore((s) => s.watchError);
  const connecting = useVoiceStore((s) => s.session?.status === 'connecting');
  const mutedOnJoin = useVoiceStore((s) => s.watchMutedOnJoin && s.muted);
  // 영상을 기다린 지 오래되면 알린다.
  const [slow, setSlow] = useState(false);
  const waiting = !stream && !joining && !connecting && !error && !!member?.sharing;
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setSlow(true), LOADING_TIMEOUT_MS);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [waiting]);
  const status = viewerStatus({
    joining,
    error,
    connecting,
    sharing: !!member?.sharing,
    stream: !!stream,
    slow,
  });
  const [frame, setFrame] = useState<Frame>(() =>
    clampFrame(readFrame() ?? defaultFrame(viewport()), viewport()),
  );
  const [maximized, setMaximized] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // 사용자가 분리한 창을 닫으면 앱 안으로 돌아온다 (보기는 계속).
  const [popup, setPopup] = usePopupWindow(() => {});
  const drag = useRef<{ edge: Edge | 'move'; x: number; y: number; start: Frame } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen(stageRef);
  const name = member ? displayName(member.user) : '참여자';
  const poppedOut = !!popup;

  // Esc로 닫는다 (분리한 창이 아닐 때).
  useEffect(() => {
    if (poppedOut) return;
    const onKey = (e: KeyboardEvent) => {
      // 전체 화면을 끝내는 Esc는 닫지 않는다 (창 채우기는 useFullscreen이 먼저 받아 막는다).
      if (e.key === 'Escape' && !e.defaultPrevented && !document.fullscreenElement) {
        void voice.watch(null, null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [poppedOut, voice]);

  // 창 크기가 바뀌면 화면 안으로 다시 맞춘다.
  useEffect(() => {
    const onResize = () => setFrame((current) => clampFrame(current, viewport()));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const close = () => void voice.watch(null, null);
  const stageProps = {
    stageRef,
    stream,
    status,
    user: member?.user ?? null,
    name,
    fullscreen: fullscreen.mode,
    onToggleFullscreen: fullscreen.toggle,
    onRetry: () => voice.retryWatch(),
    onClose: close,
  };
  // 보려고 들어오면서 꺼 둔 마이크를 바로 켤 수 있게 알린다.
  const micNotice = mutedOnJoin && (
    <p className="screen-viewer__mic" role="status">
      <MicOff aria-hidden />
      보려고 들어와서 마이크를 꺼 두었어요.
      <button type="button" className="button" onClick={() => void voice.toggleMute()}>
        마이크 켜기
      </button>
      <button
        type="button"
        className="icon-button"
        onClick={() => useVoiceStore.getState().patch({ watchMutedOnJoin: false })}
        aria-label="알림 닫기"
      >
        <X aria-hidden />
      </button>
    </p>
  );

  const beginDrag = (e: ReactPointerEvent<HTMLElement>, edge: Edge | 'move') => {
    if (e.button !== 0 || maximized) return;
    if (edge === 'move' && (e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { edge, x: e.clientX, y: e.clientY, start: frame };
  };
  const onDrag = (e: ReactPointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current) return;
    const dx = e.clientX - current.x;
    const dy = e.clientY - current.y;
    const next =
      current.edge === 'move'
        ? { ...current.start, x: current.start.x + dx, y: current.start.y + dy }
        : resizeFrame(current.start, current.edge, dx, dy);
    setFrame(clampFrame(next, viewport()));
  };
  const endDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    saveFrame(frame);
  };

  const popOut = () => {
    const opened = openPopupWindow({
      name: 'metacode-screen',
      title: `${name}의 화면`,
      width: frame.w,
      height: frame.h,
    });
    if (!opened) {
      setNotice(
        '새 창을 열지 못했습니다. 팝업 차단을 풀거나, 데스크톱 앱이면 새 버전으로 업데이트해 주세요.',
      );
      return;
    }
    setNotice(null);
    setPopup(opened);
  };

  if (popup) {
    return createPortal(
      <section className="screen-viewer screen-viewer--popout" aria-label={`${name}의 화면`}>
        <ViewerHeader
          name={name}
          stream={stream}
          onFullscreen={fullscreen.toggle}
          onPopIn={() => {
            fullscreen.exit();
            setPopup(null);
          }}
          onClose={close}
        />
        {micNotice}
        <ViewerStage {...stageProps} />
      </section>,
      popup.container,
    );
  }

  return (
    <section
      className="screen-viewer"
      data-maximized={maximized}
      style={
        maximized ? undefined : { left: frame.x, top: frame.y, width: frame.w, height: frame.h }
      }
      role="dialog"
      aria-label={`${name}의 화면`}
    >
      <ViewerHeader
        name={name}
        stream={stream}
        maximized={maximized}
        onMaximize={() => setMaximized((v) => !v)}
        onFullscreen={fullscreen.toggle}
        onPopOut={() => {
          fullscreen.exit();
          popOut();
        }}
        onClose={close}
        dragProps={{
          onPointerDown: (e: ReactPointerEvent<HTMLElement>) => beginDrag(e, 'move'),
          onPointerMove: onDrag,
          onPointerUp: endDrag,
          onPointerCancel: endDrag,
          onDoubleClick: () => setMaximized((v) => !v),
        }}
      />
      {notice && (
        <p className="screen-viewer__notice" role="alert">
          {notice}
        </p>
      )}
      {micNotice}
      <ViewerStage {...stageProps} />
      {!maximized &&
        EDGES.map((edge) => (
          <span
            key={edge}
            className={`screen-viewer__edge screen-viewer__edge--${edge}`}
            onPointerDown={(e) => beginDrag(e, edge)}
            onPointerMove={onDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
        ))}
    </section>
  );
}

function ViewerHeader({
  name,
  stream,
  maximized,
  onMaximize,
  onFullscreen,
  onPopOut,
  onPopIn,
  onClose,
  dragProps,
}: {
  name: string;
  stream: MediaStream | null;
  maximized?: boolean;
  onMaximize?: () => void;
  onFullscreen: () => void;
  onPopOut?: () => void;
  onPopIn?: () => void;
  onClose: () => void;
  dragProps?: Record<string, unknown>;
}) {
  return (
    <header className="screen-viewer__header" {...dragProps}>
      <span className="screen-viewer__live">LIVE</span>
      <strong>{name}의 화면</strong>
      {onMaximize && (
        <button
          type="button"
          className="icon-button"
          onClick={onMaximize}
          aria-label={maximized ? '원래 크기로' : '크게 보기'}
          title={maximized ? '원래 크기로' : '크게 보기 (머리글을 두 번 눌러도 됨)'}
        >
          {maximized ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
        </button>
      )}
      {onPopOut && (
        <button
          type="button"
          className="icon-button"
          onClick={onPopOut}
          aria-label="새 창으로 분리"
          title="새 창으로 분리"
        >
          <SquareArrowOutUpRight aria-hidden />
        </button>
      )}
      {onPopIn && (
        <button
          type="button"
          className="icon-button"
          onClick={onPopIn}
          aria-label="앱 안으로 되돌리기"
          title="앱 안으로 되돌리기"
        >
          <PictureInPicture2 aria-hidden />
        </button>
      )}
      <button
        type="button"
        className="icon-button"
        onClick={onFullscreen}
        disabled={!stream}
        aria-label="전체 화면"
        title="전체 화면 (영상을 두 번 눌러도 됨)"
      >
        <Expand aria-hidden />
      </button>
      <button
        type="button"
        className="icon-button"
        onClick={onClose}
        aria-label="닫기"
        title="닫기"
      >
        <X aria-hidden />
      </button>
    </header>
  );
}

function ViewerStage({
  stageRef,
  stream,
  status,
  user,
  name,
  fullscreen,
  onToggleFullscreen,
  onRetry,
  onClose,
}: {
  stageRef: RefObject<HTMLDivElement | null>;
  stream: MediaStream | null;
  status: ViewerStatus;
  user: UserProfile | null;
  name: string;
  fullscreen: FullscreenMode;
  onToggleFullscreen: () => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const videoRef: RefObject<HTMLVideoElement | null> = useRef(null);
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);
  return (
    <div className="screen-viewer__stage" ref={stageRef} data-fullscreen={fullscreen}>
      {/* 소리는 LiveKit이 따로 붙인 <audio>로 나오므로 영상은 음소거한다. */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        hidden={status.kind !== 'playing'}
        onDoubleClick={onToggleFullscreen}
      />
      {fullscreen !== 'off' && (
        <button
          type="button"
          className="screen-viewer__exit-fullscreen"
          onClick={onToggleFullscreen}
        >
          전체 화면 끝내기 (Esc)
        </button>
      )}
      {status.kind !== 'playing' && (
        <ViewerStatusPanel
          status={status}
          user={user}
          name={name}
          onRetry={onRetry}
          onClose={onClose}
        />
      )}
    </div>
  );
}

/** 영상이 없을 때 가운데에 보여 주는 것: 공유한 사람, 지금 상태, 할 수 있는 일 */
function ViewerStatusPanel({
  status,
  user,
  name,
  onRetry,
  onClose,
}: {
  status: Exclude<ViewerStatus, { kind: 'playing' }>;
  user: UserProfile | null;
  name: string;
  onRetry: () => void;
  onClose: () => void;
}) {
  const busy = status.kind === 'joining' || (status.kind === 'loading' && !status.slow);
  const text = {
    joining: `${name}님의 통화에 들어가는 중…`,
    loading:
      status.kind === 'loading' && status.slow
        ? '화면이 오지 않습니다. 연결이 느리거나 공유한 사람의 연결이 불안정할 수 있어요.'
        : '화면을 불러오는 중…',
    ended: `${name}님의 화면 공유가 끝났습니다.`,
    error: status.kind === 'error' ? status.message : '',
  }[status.kind];
  const canRetry = status.kind === 'error' || (status.kind === 'loading' && status.slow);
  return (
    <div className="screen-viewer__status" role={status.kind === 'error' ? 'alert' : 'status'}>
      {user && <Avatar user={user} size={56} animate />}
      <p>
        {busy && <span className="screen-viewer__spinner" aria-hidden />}
        {text}
      </p>
      {(canRetry || status.kind === 'ended') && (
        <div className="screen-viewer__actions">
          {canRetry && (
            <button type="button" className="button button--primary" onClick={onRetry}>
              <RotateCw aria-hidden /> 다시 시도
            </button>
          )}
          <button type="button" className="button" onClick={onClose}>
            닫기
          </button>
        </div>
      )}
    </div>
  );
}
