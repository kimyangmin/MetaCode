import { useEffect, useRef } from 'react';
import { displayName } from '../../ui/format';
import { useVoiceStore } from './store';
import { useVoice } from './VoiceProvider';

/**
 * 화면 공유 보기. 목록의 LIVE를 누르면 화면 위에 크게 띄운다.
 * 영상은 보고 있는 동안에만 받는다 (닫으면 구독을 끊는다). 소리는 따로 <audio>로 나온다.
 */
export function ScreenViewer() {
  const voice = useVoice();
  const watching = useVoiceStore((s) => s.watching);
  const stream = useVoiceStore((s) => s.screen);
  const session = useVoiceStore((s) => s.session);
  const member = useVoiceStore((s) =>
    s.session && s.watching
      ? s.calls[s.session.channelId]?.members.find((m) => m.user.id === s.watching)
      : undefined,
  );
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  // Esc로 닫는다.
  useEffect(() => {
    if (!watching) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) void voice.watch(null, null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [watching, voice]);

  if (!watching || !session) return null;
  const ended = !member?.sharing;
  const name = member ? displayName(member.user) : '참여자';

  return (
    <section className="screen-viewer" role="dialog" aria-label={`${name}의 화면`}>
      <header className="screen-viewer__header">
        <span className="screen-viewer__live">LIVE</span>
        <strong>{name}의 화면</strong>
        <button
          type="button"
          className="icon-button"
          onClick={() => void videoRef.current?.requestFullscreen()}
          disabled={!stream}
          aria-label="전체 화면"
          title="전체 화면"
        >
          ⛶
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => void voice.watch(null, null)}
          aria-label="닫기"
          title="닫기 (Esc)"
        >
          ✕
        </button>
      </header>
      <div className="screen-viewer__stage">
        {/* 소리는 LiveKit이 따로 붙인 <audio>로 나오므로 영상은 음소거한다. */}
        <video ref={videoRef} autoPlay playsInline muted hidden={!stream || ended} />
        {(ended || !stream) && (
          <p className="screen-viewer__status">
            {ended ? '화면 공유가 끝났습니다.' : '화면을 불러오는 중…'}
          </p>
        )}
      </div>
    </section>
  );
}
