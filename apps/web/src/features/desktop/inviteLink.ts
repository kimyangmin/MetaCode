import { isDesktop } from '../../platform';

/**
 * 브라우저에서 초대 링크를 열면 설치한 데스크톱 앱(metacode://)으로 먼저 열어 본다.
 * 데스크톱 앱은 Windows용만 배포하므로 Windows에서만 한다 (앱이 없는 다른 OS에서는 브라우저가
 * "주소를 열 수 없음" 오류를 띄울 수 있다). "브라우저에서 계속"을 고르면 이 탭에서는 다시 묻지 않는다.
 */
const INVITE_PATH = /^\/invite\/([A-Za-z0-9]{4,32})\/?$/;
const STAY_KEY = 'metacode:invite-in-browser';

export const appInviteUrl = (code: string) => `metacode://invite/${code}`;

/** 앱으로 열어 볼 초대 코드 (해당하지 않으면 null) */
export function inviteToOpenInApp(
  pathname = window.location.pathname,
  userAgent = navigator.userAgent,
  desktop = isDesktop(),
): string | null {
  if (desktop || !/Windows/i.test(userAgent)) return null;
  const code = INVITE_PATH.exec(pathname)?.[1];
  if (!code) return null;
  try {
    if (sessionStorage.getItem(STAY_KEY) === code) return null;
  } catch {
    // 저장소를 못 쓰면 매번 묻는다.
  }
  return code;
}

/** 이 초대는 브라우저에서 계속한다 (로그인하러 다녀와도 다시 묻지 않게) */
export function stayInBrowser(code: string): void {
  try {
    sessionStorage.setItem(STAY_KEY, code);
  } catch {
    // 무시
  }
}
