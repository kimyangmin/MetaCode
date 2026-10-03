import { type CSSProperties, useRef, useState } from 'react';
import { type NotifyLevel, useNotificationSettings } from '../notifications/settings';
import {
  playNotificationSound,
  resetSound,
  setCustomSound,
  useNotificationSound,
} from '../notifications/sound';

const LEVELS: { id: NotifyLevel; label: string }[] = [
  { id: 'all', label: '모든 메시지' },
  { id: 'mentions', label: 'DM과 멘션만' },
  { id: 'off', label: '받지 않음' },
];

const canNotify = typeof Notification !== 'undefined';

/** 설정 → 앱 설정 → 알림: 알릴 메시지, 알림음(mp3로 바꾸기), 시스템 알림. 이 기기에만 저장한다 */
export function NotificationSettings() {
  const settings = useNotificationSettings();
  const sound = useNotificationSound();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState(canNotify ? Notification.permission : 'denied');
  const percent = Math.round(settings.volume * 100);

  const toggleDesktop = async (on: boolean) => {
    if (!on || !canNotify) {
      settings.update({ desktop: false });
      return;
    }
    const result =
      Notification.permission === 'default'
        ? await Notification.requestPermission()
        : Notification.permission;
    setPermission(result);
    settings.update({ desktop: result === 'granted' });
  };

  return (
    <div className="settings-form">
      <h3 className="settings-form__title">알릴 메시지</h3>
      <div className="tabs" role="radiogroup" aria-label="알릴 메시지">
        {LEVELS.map((level) => (
          <button
            key={level.id}
            type="button"
            role="radio"
            aria-checked={settings.level === level.id}
            aria-selected={settings.level === level.id}
            onClick={() => settings.update({ level: level.id })}
          >
            {level.label}
          </button>
        ))}
      </div>

      <h3 className="settings-form__title">알림음</h3>
      <label className="voice-check">
        <input
          type="checkbox"
          checked={settings.sound}
          onChange={(e) => settings.update({ sound: e.target.checked })}
        />
        알림음 켜기
      </label>
      <label className="voice-field">
        <span className="voice-field__label">
          크기
          <output>{percent}%</output>
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={percent}
          disabled={!settings.sound}
          style={{ '--fill': `${percent}%` } as CSSProperties}
          onChange={(e) => settings.update({ volume: Number(e.target.value) / 100 })}
        />
      </label>
      <div className="notification-sound">
        <span className="notification-sound__name">{sound.customName ?? '기본 알림음'}</span>
        <button
          type="button"
          className="button"
          onClick={() => playNotificationSound(settings.volume)}
        >
          들어 보기
        </button>
        <button type="button" className="button" onClick={() => fileRef.current?.click()}>
          mp3 고르기
        </button>
        {sound.customName && (
          <button
            type="button"
            className="button"
            onClick={() => {
              setError(null);
              void resetSound();
            }}
          >
            기본으로
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".mp3,audio/mpeg"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            setError(null);
            void setCustomSound(file).then(setError);
          }}
        />
      </div>
      {error && (
        <p className="form__error" role="alert">
          {error}
        </p>
      )}

      <h3 className="settings-form__title">알림 창</h3>
      <label className="voice-check">
        <input
          type="checkbox"
          checked={settings.desktop && permission === 'granted'}
          disabled={!canNotify}
          onChange={(e) => void toggleDesktop(e.target.checked)}
        />
        시스템 알림 보이기
      </label>
      {canNotify && permission === 'denied' && (
        <p className="form__hint">브라우저(또는 앱)에서 알림 권한이 막혀 있습니다.</p>
      )}
    </div>
  );
}
