import { isDesktop } from '../../platform';

/**
 * 브라우저에서 초대 링크를 열면 설치한 데스크톱 앱(metacode://)으로 먼저 열어 본다.
 * 데스크톱 앱이 있는 Windows·macOS·Linux에서만 한다 (iPad·Android·ChromeOS에는 앱이 없음).
 * "브라우저에서 계속"을 고르면 이 탭에서는 그 초대를 다시 묻지 않는다.
 */
const INVITE_PATH = /^\/invite\/([A-Za-z0-9]{4,32})\/?$/;
const STAY_KEY = 'metacode:invite-in-browser';

export const appInviteUrl = (code: string) => `metacode://invite/${code}`;

export type DesktopOs = 'windows' | 'mac' | 'linux';

/**
 * 데스크톱 앱을 설치할 수 있는 OS. iPadOS Safari는 Mac이라고 알리므로 터치 지점 수로 가려낸다.
 */
export function desktopOs(userAgent: string, maxTouchPoints = 0): DesktopOs | null {
  if (/Windows/i.test(userAgent)) return 'windows';
  if (/Android|CrOS|iPhone|iPad/i.test(userAgent)) return null;
  if (/Macintosh|Mac OS X/i.test(userAgent)) return maxTouchPoints > 1 ? null : 'mac';
  if (/Linux|X11/i.test(userAgent)) return 'linux';
  return null;
}

/** 앱으로 열어 볼 초대 코드 (해당하지 않으면 null) */
export function inviteToOpenInApp(
  pathname = window.location.pathname,
  userAgent = navigator.userAgent,
  desktop = isDesktop(),
  maxTouchPoints = navigator.maxTouchPoints ?? 0,
): string | null {
  if (desktop || !desktopOs(userAgent, maxTouchPoints)) return null;
  const code = INVITE_PATH.exec(pathname)?.[1];
  if (!code) return null;
  try {
    if (sessionStorage.getItem(STAY_KEY) === code) return null;
  } catch {
    // 저장소를 못 쓰면 매번 묻는다.
  }
  return code;
}

/**
 * 앱 주소를 여는 방법. Chromium 계열(Chrome, Edge, Whale, Comet 등)은 앱이 없으면 조용히 넘어가므로 페이지를
 * 그대로 옮긴다. Safari와 Firefox는 앱이 없으면 경고 창이나 오류 페이지를 띄우므로 숨긴 iframe으로 열어 본다
 * (페이지가 오류 화면으로 바뀌지 않게).
 */
export function appOpenMethod(userAgent: string): 'navigate' | 'iframe' {
  return /Chrome\/|Chromium\/|Edg\//.test(userAgent) ? 'navigate' : 'iframe';
}

/** 앱 주소를 연다 (들어오자마자 한 번. "앱에서 열기" 버튼은 링크라 따로 부르지 않는다) */
export function openAppUrl(url: string, userAgent = navigator.userAgent): void {
  if (appOpenMethod(userAgent) === 'navigate') {
    window.location.href = url;
    return;
  }
  const frame = document.createElement('iframe');
  frame.style.display = 'none';
  frame.src = url;
  document.body.append(frame);
  setTimeout(() => frame.remove(), 3000);
}

/** 이 초대는 브라우저에서 계속한다 (로그인하러 다녀와도 다시 묻지 않게) */
export function stayInBrowser(code: string): void {
  try {
    sessionStorage.setItem(STAY_KEY, code);
  } catch {
    // 무시
  }
}
