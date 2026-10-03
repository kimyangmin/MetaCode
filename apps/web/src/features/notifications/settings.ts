import { create } from 'zustand';

/** 어떤 메시지에 알릴지: 모든 메시지 / DM과 나를 부른 메시지(멘션·내 메시지에 답장) / 알리지 않음 */
export type NotifyLevel = 'all' | 'mentions' | 'off';

export interface NotificationSettings {
  level: NotifyLevel;
  /** 알림음 */
  sound: boolean;
  /** 알림음 크기 (0~1) */
  volume: number;
  /** 시스템 알림 창 (브라우저·데스크톱 앱의 알림) */
  desktop: boolean;
}

const KEY = 'metacode:notifications';

const DEFAULTS: NotificationSettings = {
  level: 'mentions',
  sound: true,
  volume: 0.7,
  desktop: false,
};

function read(): NotificationSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<NotificationSettings>;
    if (!saved) return DEFAULTS;
    return {
      level: saved.level === 'all' || saved.level === 'off' ? saved.level : 'mentions',
      sound: saved.sound ?? DEFAULTS.sound,
      volume:
        typeof saved.volume === 'number' ? Math.min(1, Math.max(0, saved.volume)) : DEFAULTS.volume,
      desktop: saved.desktop ?? DEFAULTS.desktop,
    };
  } catch {
    return DEFAULTS;
  }
}

interface NotificationSettingsState extends NotificationSettings {
  update(change: Partial<NotificationSettings>): void;
}

/** 알림 설정 (설정 → 앱 설정). 기기마다 기억하고, 다른 창에서 바꾸면 따라간다 */
export const useNotificationSettings = create<NotificationSettingsState>((set, get) => ({
  ...read(),
  update: (change) => {
    set(change);
    const { level, sound, volume, desktop } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify({ level, sound, volume, desktop }));
    } catch {
      // 기억하지 못해도 이 창에는 적용된다.
    }
  },
}));

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) useNotificationSettings.setState(read());
  });
}
