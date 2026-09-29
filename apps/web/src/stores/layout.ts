import { create } from 'zustand';
import { type Arrangement, DEFAULT_ARRANGEMENT, type PanelKey } from '../layout/arrangement';
import { isDesktop } from '../platform';

const ARRANGEMENT_KEY = 'metacode:arrangement';
const PHONE_FIRST_KEY = 'metacode:phone-first';
/** 분리한 창이 닫혔는지 확인하는 간격 (닫히면 메인 창으로 돌려놓는다) */
const WATCH_MS = 800;

function readArrangement(): Arrangement {
  try {
    const saved = JSON.parse(localStorage.getItem(ARRANGEMENT_KEY) ?? 'null') as Arrangement | null;
    if (
      saved &&
      (saved.orientation === 'horizontal' || saved.orientation === 'vertical') &&
      (saved.first === 'chat' || saved.first === 'plaza')
    ) {
      return saved;
    }
  } catch {
    // 저장소를 못 쓰면 기본 배치
  }
  return DEFAULT_ARRANGEMENT;
}

function readPhoneFirst(): PanelKey {
  try {
    return localStorage.getItem(PHONE_FIRST_KEY) === 'chat' ? 'chat' : 'plaza';
  } catch {
    return 'plaza';
  }
}

/** 분리한 창 (한 패널에 하나) */
const popouts = new Map<PanelKey, Window>();

interface LayoutState {
  /** 채팅과 광장의 배치 (기억한다) */
  arrangement: Arrangement;
  /** 휴대폰 화면(위아래로만 나눔)에서 위에 오는 패널 (기억한다, 처음엔 광장) */
  phoneFirst: PanelKey;
  setPhoneFirst(first: PanelKey): void;
  /** 별도 창으로 분리해서 메인 창에서는 숨긴 패널 */
  detached: Record<PanelKey, boolean>;
  setArrangement(arrangement: Arrangement): void;
  /** 패널을 새 창으로 연다. 브라우저가 팝업을 막으면 false */
  detach(key: PanelKey, path: string, at?: { x: number; y: number }): boolean;
  /** 분리한 창을 닫고 메인 창으로 돌려놓는다 */
  reattach(key: PanelKey): void;
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  arrangement: readArrangement(),
  phoneFirst: readPhoneFirst(),
  detached: { chat: false, plaza: false },

  setPhoneFirst: (phoneFirst) => {
    try {
      localStorage.setItem(PHONE_FIRST_KEY, phoneFirst);
    } catch {
      // 기억하지 못해도 지금 화면에는 적용된다.
    }
    set({ phoneFirst });
  },

  setArrangement: (arrangement) => {
    try {
      localStorage.setItem(ARRANGEMENT_KEY, JSON.stringify(arrangement));
    } catch {
      // 기억하지 못해도 지금 화면에는 적용된다.
    }
    set({ arrangement });
  },

  detach: (key, path, at) => {
    popouts.get(key)?.close();
    const width = key === 'chat' ? 480 : 820;
    const height = 680;
    const features = [
      'popup',
      `width=${width}`,
      `height=${height}`,
      ...(at ? [`left=${Math.round(at.x - 60)}`, `top=${Math.round(at.y - 20)}`] : []),
    ].join(',');
    const popup = window.open(appUrl(path), `metacode-${key}`, features);
    if (!popup) return false;
    popouts.set(key, popup);
    set({ detached: { ...get().detached, [key]: true } });
    const timer = setInterval(() => {
      if (!popup.closed) return;
      clearInterval(timer);
      if (popouts.get(key) === popup) popouts.delete(key);
      set({ detached: { ...get().detached, [key]: false } });
    }, WATCH_MS);
    return true;
  },

  reattach: (key) => {
    popouts.get(key)?.close();
    popouts.delete(key);
    set({ detached: { ...get().detached, [key]: false } });
  },
}));

/** 앱 안의 주소 (데스크톱은 해시 주소) */
export function appUrl(path: string): string {
  const { origin, pathname } = window.location;
  return isDesktop() ? `${origin}${pathname}#${path}` : `${origin}${path}`;
}

// 메인 창을 닫으면 분리한 창도 닫는다.
window.addEventListener('beforeunload', () => {
  for (const popup of popouts.values()) popup.close();
});
