import { type MouseEvent, useEffect, useRef, useState } from 'react';
import { getDesktopBridge, isDesktop } from '../../platform';
import { useSettingsStore } from '../../stores/settings';
import { DeviceSelect, InputGainSlider, OutputVolumeSlider } from './devices';
import { useChannelLabel } from './hooks';
import { ScreenPicker } from './ScreenPicker';
import { useCall, useVoiceStore } from './store';
import { useVoice } from './VoiceProvider';

const STATUS_LABEL = {
  connecting: '연결 중…',
  connected: '음성 연결됨',
  reconnecting: '다시 연결 중…',
} as const;

type MenuKind = 'mic' | 'headset';

/**
 * 사이드바 아래: 지금 통화, 나가기, 마이크·헤드셋·화면 공유 버튼.
 * 마이크·헤드셋 버튼을 우클릭하거나 옆의 ˄를 누르면 팝업이 뜬다
 * (마이크: 입력 장치와 증폭, 헤드셋: 출력 장치와 음량, 근접 음성).
 */
export function VoicePanel({ meId }: { meId: string }) {
  const voice = useVoice();
  const session = useVoiceStore((s) => s.session);
  const error = useVoiceStore((s) => s.error);
  const muted = useVoiceStore((s) => s.muted);
  const deafened = useVoiceStore((s) => s.deafened);
  const playbackBlocked = useVoiceStore((s) => s.playbackBlocked);
  const call = useCall(session?.channelId ?? '');
  const label = useChannelLabel(session?.channelId, meId);
  const [menu, setMenu] = useState<MenuKind | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const sharing = useVoiceStore((s) => s.sharing);

  const toggleScreen = () => {
    if (sharing) return void voice.stopScreenShare();
    // 화질을 고르는 창을 먼저 띄운다. 데스크톱 앱은 여기서 화면도 고른다 (0.1.0 앱에는 그 기능이 없다).
    if (!isDesktop() || getDesktopBridge()?.screen) return setPickerOpen(true);
    useVoiceStore.getState().patch({
      error: '화면 공유를 쓰려면 데스크톱 앱을 새 버전으로 설치해 주세요.',
    });
  };

  if (!session && !error) return null;
  const micOff = muted || deafened || !!session?.listenOnly;
  const toggleMenu = (kind: MenuKind) => setMenu((current) => (current === kind ? null : kind));
  const openMenuOnRightClick = (kind: MenuKind) => (e: MouseEvent) => {
    e.preventDefault();
    setMenu(kind);
  };

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
            <div className="voice-split">
              <button
                type="button"
                className="voice-toggle"
                aria-pressed={micOff}
                onClick={() => void voice.toggleMute()}
                onContextMenu={openMenuOnRightClick('mic')}
                title={
                  micOff
                    ? '마이크 켜기 (우클릭: 마이크 설정)'
                    : '마이크 음소거 (우클릭: 마이크 설정)'
                }
              >
                {micOff ? '🔇' : '🎙️'}
                <span>마이크</span>
              </button>
              <MenuCaret kind="mic" open={menu === 'mic'} onToggle={toggleMenu} />
            </div>
            <div className="voice-split">
              <button
                type="button"
                className="voice-toggle"
                aria-pressed={deafened}
                onClick={() => void voice.toggleDeafen()}
                onContextMenu={openMenuOnRightClick('headset')}
                title={
                  deafened
                    ? '헤드셋 켜기 (우클릭: 헤드셋 설정)'
                    : '헤드셋 끄기, 아무것도 듣지 않음 (우클릭: 헤드셋 설정)'
                }
              >
                {deafened ? '🔕' : '🎧'}
                <span>헤드셋</span>
              </button>
              <MenuCaret kind="headset" open={menu === 'headset'} onToggle={toggleMenu} />
            </div>
            <button
              type="button"
              className="voice-toggle"
              aria-pressed={sharing}
              disabled={session.status !== 'connected'}
              onClick={toggleScreen}
              title={sharing ? '화면 공유 중지' : '화면 공유'}
            >
              🖥️<span>화면</span>
            </button>
            {menu && (
              <VoiceMenu
                kind={menu}
                proximity={call?.proximity ?? false}
                canToggleProximity={session.status !== 'connecting'}
                onProximity={(enabled) => void voice.setProximity(enabled)}
                onClose={() => setMenu(null)}
              />
            )}
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
      {pickerOpen && (
        <ScreenPicker
          onClose={() => setPickerOpen(false)}
          onStart={(quality) => {
            setPickerOpen(false);
            void voice.startScreenShare(quality);
          }}
        />
      )}
    </section>
  );
}

const MENU_LABEL = { mic: '마이크 설정', headset: '헤드셋 설정' } as const;

/** 마이크·헤드셋 옆의 ˄: 누르면 그 설정 팝업을 열고 닫는다 */
function MenuCaret({
  kind,
  open,
  onToggle,
}: {
  kind: MenuKind;
  open: boolean;
  onToggle(kind: MenuKind): void;
}) {
  return (
    <button
      type="button"
      className="voice-caret"
      aria-expanded={open}
      aria-label={MENU_LABEL[kind]}
      title={MENU_LABEL[kind]}
      // 팝업 바깥 누르기로 닫히는 것과 겹쳐 곧바로 다시 열리지 않게 한다.
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => onToggle(kind)}
    >
      <svg viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">
        <path d="M1 5l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </button>
  );
}

/**
 * 마이크·헤드셋 설정 팝업 (버튼 위에 뜬다). 바깥을 누르거나 Esc를 누르면 닫힌다.
 * 마이크: 입력 장치, 증폭. 헤드셋: 출력 장치, 음량, 근접 음성.
 */
function VoiceMenu({
  kind,
  proximity,
  canToggleProximity,
  onProximity,
  onClose,
}: {
  kind: MenuKind;
  proximity: boolean;
  canToggleProximity: boolean;
  onProximity(enabled: boolean): void;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: globalThis.MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="voice-menu" role="dialog" aria-label={MENU_LABEL[kind]}>
      {kind === 'mic' ? (
        <>
          <DeviceSelect kind="audioinput" />
          <InputGainSlider />
        </>
      ) : (
        <>
          <DeviceSelect kind="audiooutput" />
          <OutputVolumeSlider />
          <label className="voice-menu__switch">
            <input
              type="checkbox"
              role="switch"
              checked={proximity}
              disabled={!canToggleProximity}
              onChange={(e) => onProximity(e.target.checked)}
            />
            <span>
              <strong>📍 근접 음성</strong>
              <small>
                켜면 광장에서 가까운 사람끼리만 들립니다. 통화 참여자 누구나 바꿀 수 있습니다.
              </small>
            </span>
          </label>
        </>
      )}
      <button
        type="button"
        className="voice-menu__more"
        onClick={() => {
          onClose();
          useSettingsStore.getState().open('voice');
        }}
      >
        음성 설정 열기 ›
      </button>
    </div>
  );
}
