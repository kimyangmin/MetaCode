import type { MetaCodeDesktopBridge } from '@metacode/shared';

/**
 * 웹/데스크톱/안드로이드 차이를 감추는 계층. 데스크톱·안드로이드 기능은 반드시 여기를 거쳐서 쓴다.
 * 브라우저에서는 브리지가 없으므로 웹 대체 동작으로 돌아간다.
 */
export function getDesktopBridge(): MetaCodeDesktopBridge | undefined {
  return window.metacode;
}

export function isDesktop(): boolean {
  return getDesktopBridge() !== undefined;
}

/**
 * 안드로이드 앱(Capacitor) 안에서 열렸는지. 앱은 User-Agent에 MetaCodeAndroid를 붙이고
 * (capacitor.config.json의 appendUserAgent), Capacitor 브리지(window.Capacitor)를 넣는다.
 */
export function isAndroidApp(): boolean {
  return navigator.userAgent.includes('MetaCodeAndroid') && 'Capacitor' in window;
}

/** 안드로이드 앱 전용 기능. 브라우저·데스크톱에서는 불러오지 않는다 (Capacitor 플러그인 코드) */
export const loadAndroid = () => import('./android');

/** 화면 공유를 할 수 있는 환경인지 (안드로이드 앱의 WebView와 휴대폰 브라우저는 getDisplayMedia가 없다) */
export function canShareScreen(): boolean {
  return isDesktop() || typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}
