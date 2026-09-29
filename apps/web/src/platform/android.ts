import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { AuthClient } from '@metacode/shared';
import { API_URL } from '../config';
import { type AppLink, parseAppLink, pkceChallenge, randomVerifier } from './appLinks';

/**
 * 안드로이드 앱(Capacitor)에서만 불러오는 부분 (platform/index.ts의 loadAndroid).
 * 앱은 운영 웹을 그대로 열므로 인증은 웹과 같은 쿠키를 쓰고, 여기서는 앱에만 있는 것만 맡는다:
 * GitHub 로그인(Custom Tab + 딥링크 + PKCE), metacode:// 주소 받기, 뒤로 가기 버튼, 바깥 브라우저로 열기.
 */

/** 로그인을 시작할 때 만든 PKCE verifier. 앱이 Custom Tab에 가려져 있다가 다시 켜져도 남도록 저장한다 */
const VERIFIER_KEY = 'metacode:android-pkce';
/** 이미 처리한 주소 (앱을 켠 주소는 새로 고침해도 다시 오므로 두 번 처리하지 않는다) */
const HANDLED_KEY = 'metacode:android-handled-link';

function storage(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? localStorage : sessionStorage;
  } catch {
    return null;
  }
}

/** GitHub 로그인: 시스템 브라우저(Custom Tab)에서 로그인하고 metacode://auth로 돌아온다 */
export async function startLogin(): Promise<void> {
  const verifier = randomVerifier();
  storage('local')?.setItem(VERIFIER_KEY, verifier);
  const challenge = await pkceChallenge(verifier);
  const url = new URL(`${API_URL}/auth/github`);
  url.searchParams.set('client', AuthClient.Android);
  url.searchParams.set('code_challenge', challenge);
  await Browser.open({ url: url.href });
}

/** 딥링크로 받은 코드와 verifier를 로그인 쿠키로 바꾼다 */
async function finishLogin(code: string): Promise<void> {
  const codeVerifier = storage('local')?.getItem(VERIFIER_KEY);
  storage('local')?.removeItem(VERIFIER_KEY);
  if (!codeVerifier) throw new Error('로그인 요청이 만료되었습니다. 다시 시도해 주세요.');
  const res = await fetch(`${API_URL}/auth/android/session`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, codeVerifier }),
  });
  if (!res.ok) throw new Error('로그인하지 못했습니다. 다시 시도해 주세요.');
}

export interface AppLinkHandlers {
  /** 로그인 쿠키를 받았다 (내 정보를 다시 불러온다) */
  onLogin(): void;
  /** 로그인에 실패했다. reason은 서버의 사유 코드(access_denied 등) 또는 문장 */
  onLoginError(reason: string): void;
  /** 초대 링크 등 앱 안의 화면으로 옮긴다 */
  onNavigate(route: string): void;
}

/** metacode:// 주소를 받는다: 앱이 켜져 있을 때 온 것과, 그 주소로 앱이 켜진 것 모두. 끄는 함수를 돌려준다 */
export function listenAppLinks(handlers: AppLinkHandlers): () => void {
  const handle = async (url: string) => {
    if (storage('session')?.getItem(HANDLED_KEY) === url) return;
    storage('session')?.setItem(HANDLED_KEY, url);
    const link: AppLink | null = parseAppLink(url);
    if (!link) return;
    if (link.kind === 'navigate') {
      handlers.onNavigate(link.route);
      return;
    }
    void Browser.close().catch(() => {});
    if (link.kind === 'loginError') {
      storage('local')?.removeItem(VERIFIER_KEY);
      handlers.onLoginError(link.reason);
      return;
    }
    try {
      await finishLogin(link.code);
      handlers.onLogin();
    } catch (error) {
      handlers.onLoginError(error instanceof Error ? error.message : 'github_error');
    }
  };

  const listener = App.addListener('appUrlOpen', ({ url }) => void handle(url));
  void App.getLaunchUrl().then((launch) => {
    if (launch?.url) void handle(launch.url);
  });
  return () => void listener.then((l) => l.remove());
}

/**
 * 안드로이드 뒤로 가기 버튼: 열린 서랍·창을 먼저 닫고(Esc와 같게), 없으면 앞 화면으로, 더 없으면 앱을 내린다.
 * closeOverlay가 무언가 닫았으면 true를 돌려준다.
 */
export function listenBackButton(closeOverlay: () => boolean): () => void {
  const listener = App.addListener('backButton', ({ canGoBack }) => {
    if (closeOverlay()) return;
    if (canGoBack) window.history.back();
    else void App.minimizeApp();
  });
  return () => void listener.then((l) => l.remove());
}

/** 앱 밖(시스템 브라우저, Custom Tab)으로 연다. 첨부 받기처럼 앱 창이 할 수 없는 것에 쓴다 */
export async function openExternal(url: string): Promise<void> {
  await Browser.open({ url });
}
