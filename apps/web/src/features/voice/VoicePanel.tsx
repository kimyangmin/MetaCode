import { useEffect, useState } from 'react';
import { Dialog } from '../../ui/Dialog';
import { useChannelLabel } from './hooks';
import { useCall, useVoiceStore } from './store';
import { useVoice } from './VoiceProvider';

const STATUS_LABEL = {
  connecting: '연결 중…',
  connected: '음성 연결됨',
  reconnecting: '다시 연결 중…',
} as const;

/** 사이드바 아래: 지금 통화와 마이크·헤드셋·근접 음성·장치 설정, 나가기 */
export function VoicePanel({ meId }: { meId: string }) {
  const voice = useVoice();
  const session = useVoiceStore((s) => s.session);
  const error = useVoiceStore((s) => s.error);
  const muted = useVoiceStore((s) => s.muted);
  const deafened = useVoiceStore((s) => s.deafened);
  const playbackBlocked = useVoiceStore((s) => s.playbackBlocked);
  const call = useCall(session?.channelId ?? '');
  const label = useChannelLabel(session?.channelId, meId);
  const [devicesOpen, setDevicesOpen] = useState(false);

  if (!session && !error) return null;
  const micOff = muted || deafened || !!session?.listenOnly;

  return (
    <section className="voice-panel" aria-label="음성 통화">
      {session && (
        <>
          <div className="voice-panel__head">
            <div className="voice-panel__where">
              <strong className="voice-panel__status" data-status={session.status}>
                {STATUS_LABEL[session.status]}
              </strong>
              {label && (
                <span className="voice-panel__channel" title={`${label.name} · ${label.place}`}>
                  {label.kind === 'voice' ? '🔊' : '📞'} {label.name} · {label.place}
                </span>
              )}
            </div>
            <button
              type="button"
              className="icon-button voice-panel__leave"
              onClick={() => voice.leave()}
              aria-label="통화 나가기"
              title="통화 나가기"
            >
              ✕
            </button>
          </div>
          {session.listenOnly && (
            <p className="voice-panel__notice">
              마이크를 쓸 수 없어 듣기만 하고 있습니다. 🎙️를 누르면 다시 시도합니다.
            </p>
          )}
          {playbackBlocked && (
            <button
              type="button"
              className="button voice-panel__unmute"
              onClick={() => voice.startAudio()}
            >
              소리 켜기
            </button>
          )}
          <div className="voice-panel__controls">
            <button
              type="button"
              className="voice-toggle"
              aria-pressed={micOff}
              onClick={() => void voice.toggleMute()}
              title={micOff ? '마이크 켜기' : '마이크 음소거'}
            >
              {micOff ? '🔇' : '🎙️'}
              <span>마이크</span>
            </button>
            <button
              type="button"
              className="voice-toggle"
              aria-pressed={deafened}
              onClick={() => void voice.toggleDeafen()}
              title={deafened ? '헤드셋 켜기' : '헤드셋 끄기 (아무것도 듣지 않음)'}
            >
              {deafened ? '🔕' : '🎧'}
              <span>헤드셋</span>
            </button>
            <button
              type="button"
              className="voice-toggle"
              aria-pressed={call?.proximity ?? false}
              disabled={session.status === 'connecting'}
              onClick={() => void voice.setProximity(!call?.proximity)}
              title="근접 음성: 켜면 광장에서 가까운 사람끼리만 들립니다. 참여자 누구나 바꿀 수 있습니다."
            >
              📍<span>근접</span>
            </button>
            <button
              type="button"
              className="voice-toggle"
              onClick={() => setDevicesOpen(true)}
              title="입출력 장치"
            >
              ⚙️<span>장치</span>
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="voice-panel__error" role="alert">
          {error}
          <button
            type="button"
            className="icon-button"
            onClick={() => useVoiceStore.getState().patch({ error: null })}
            aria-label="닫기"
          >
            ×
          </button>
        </p>
      )}
      {devicesOpen && <DeviceDialog onClose={() => setDevicesOpen(false)} />}
    </section>
  );
}

/** 마이크와 스피커 고르기. 고른 장치는 기억해서 다음 통화에도 쓴다 */
function DeviceDialog({ onClose }: { onClose(): void }) {
  const voice = useVoice();
  const inputDeviceId = useVoiceStore((s) => s.inputDeviceId);
  const outputDeviceId = useVoiceStore((s) => s.outputDeviceId);
  const [devices, setDevices] = useState<MediaDeviceInfo[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      navigator.mediaDevices
        .enumerateDevices()
        .then((list) => !cancelled && setDevices(list))
        .catch(() => !cancelled && setDevices([]));
    void load();
    navigator.mediaDevices.addEventListener('devicechange', load);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener('devicechange', load);
    };
  }, []);

  const inputs = devices?.filter((d) => d.kind === 'audioinput') ?? [];
  const outputs = devices?.filter((d) => d.kind === 'audiooutput') ?? [];
  // 권한을 받기 전에는 장치 이름이 비어 있다.
  const name = (d: MediaDeviceInfo, i: number) =>
    d.label || (d.kind === 'audioinput' ? `마이크 ${i + 1}` : `스피커 ${i + 1}`);

  return (
    <Dialog title="입출력 장치" onClose={onClose}>
      <div className="form">
        <label>
          마이크
          <select
            value={inputDeviceId ?? 'default'}
            onChange={(e) => void voice.switchDevice('audioinput', e.target.value)}
            disabled={inputs.length === 0}
          >
            {inputs.length === 0 && <option>마이크를 찾지 못했습니다</option>}
            {inputs.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {name(d, i)}
              </option>
            ))}
          </select>
        </label>
        <label>
          스피커
          <select
            value={outputDeviceId ?? 'default'}
            onChange={(e) => void voice.switchDevice('audiooutput', e.target.value)}
            disabled={outputs.length === 0}
          >
            {outputs.length === 0 && <option>이 환경에서는 스피커를 고를 수 없습니다</option>}
            {outputs.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {name(d, i)}
              </option>
            ))}
          </select>
        </label>
        <p className="form__hint">통화 중이면 바로 바뀌고, 다음 통화에도 이 장치를 씁니다.</p>
      </div>
    </Dialog>
  );
}
