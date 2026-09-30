import type { AuthTokens } from '@metacode/shared';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { create } from 'zustand';
import { API_URL } from '../config';
import { createPkcePair } from './pkce';

/**
 * 로그인 상태와 토큰. 데스크톱 앱과 같은 방식이다:
 * - 로그인: Custom Tab으로 GitHub 로그인 → 서버가 metacode://auth?code=로 돌려보냄 → 코드 + PKCE verifier를
 *   `POST /auth/android/token`으로 토큰과 바꾼다.
 * - 액세스 토큰(15분)은 메모리에만, 리프레시 토큰(30일)은 SecureStore(안드로이드 Keystore로 암호화)에 둔다.
 * - 서버에 닿지 않으면 토큰을 지우지 않고 'unavailable'로 둔다 (로그아웃과 구분). 401일 때만 로그아웃이다.
 */

export type SessionStatus = 'loading' | 'signedOut' | 'signedIn' | 'unavailable';

interface SessionState {
  status: SessionStatus;
  /** 로그인 화면에 보여 줄 실패 사유 */
  loginError: string | null;
}

export const useSession = create<SessionState>(() => ({ status: 'loading', loginError: null }));

const REFRESH_KEY = 'metacode.refreshToken';
/** 로그인하는 동안의 verifier. 앱이 꺼졌다 metacode://auth로 다시 켜져도 이어서 로그인할 수 있게 저장한다 */
const VERIFIER_KEY = 'metacode.pkceVerifier';
export const AUTH_REDIRECT = 'metacode://auth';
/** 만료 이만큼 전에 미리 갱신한다 (ms) */
const EXPIRY_MARGIN_MS = 30_000;

/** 로그인이 끊겼다 (리프레시 토큰이 없거나 서버가 거절함) */
export class SignedOutError extends Error {}
/** 서버에 닿지 않았다. 토큰은 그대로 둔다 */
export class NetworkError extends Error {}

let access: { token: string; expiresAt: number } | null = null;
let refreshing: Promise<string> | null = null;

async function postJson<T>(
  path: string,
  body: unknown,
): Promise<{ status: number; data: T | null }> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new NetworkError('서버에 연결하지 못했습니다.');
  }
  if (res.status >= 500) throw new NetworkError(`서버 오류 (${res.status})`);
  const data = res.ok && res.status !== 204 ? ((await res.json()) as T) : null;
  return { status: res.status, data };
}

async function saveTokens(tokens: AuthTokens): Promise<string> {
  await SecureStore.setItemAsync(REFRESH_KEY, tokens.refreshToken);
  access = {
    token: tokens.accessToken,
    expiresAt: Date.now() + tokens.accessTokenExpiresIn * 1000,
  };
  return tokens.accessToken;
}

async function clearTokens(): Promise<void> {
  access = null;
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}

/** 리프레시 토큰으로 새 토큰을 받는다. 동시에 여러 번 불러도 한 번만 갱신한다 */
function refresh(): Promise<string> {
  refreshing ??= (async () => {
    const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
    if (!refreshToken) throw new SignedOutError();
    const { status, data } = await postJson<AuthTokens>('/auth/refresh', { refreshToken });
    if (!data) {
      if (status === 401) {
        await clearTokens();
        useSession.setState({ status: 'signedOut' });
        throw new SignedOutError();
      }
      throw new NetworkError(`요청 실패 (${status})`);
    }
    return saveTokens(data);
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/**
 * API·소켓에 붙일 액세스 토큰. 만료가 가까우면 갱신한다.
 * @param force 서버가 401을 돌려줬을 때: 가진 토큰을 믿지 않고 갱신한다
 */
export async function getAccessToken(force = false): Promise<string> {
  if (!force && access && access.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return access.token;
  return refresh();
}

/** 앱을 켤 때: 저장된 리프레시 토큰으로 로그인을 되살린다. 서버가 잠깐 안 되면 1초, 2초 뒤 다시 해 본다 */
export async function restoreSession(): Promise<void> {
  useSession.setState({ status: 'loading' });
  if (!(await SecureStore.getItemAsync(REFRESH_KEY))) {
    useSession.setState({ status: 'signedOut' });
    return;
  }
  for (const delay of [0, 1000, 2000]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      await refresh();
      useSession.setState({ status: 'signedIn' });
      return;
    } catch (error) {
      if (error instanceof SignedOutError) {
        useSession.setState({ status: 'signedOut' });
        return;
      }
    }
  }
  useSession.setState({ status: 'unavailable' });
}

/** 로그인 시작: Custom Tab으로 GitHub 로그인을 열고, 돌아오면 이어서 토큰을 받는다 */
export async function signIn(): Promise<void> {
  useSession.setState({ loginError: null });
  const { verifier, challenge } = await createPkcePair();
  await SecureStore.setItemAsync(VERIFIER_KEY, verifier);
  const url = `${API_URL}/auth/github?client=android&code_challenge=${challenge}`;
  const result = await WebBrowser.openAuthSessionAsync(url, AUTH_REDIRECT);
  if (result.type === 'success') await completeSignIn(result.url);
}

const LOGIN_ERRORS: Record<string, string> = {
  access_denied: 'GitHub에서 로그인을 취소했습니다.',
  invalid_state: '로그인 요청이 만료되었습니다. 다시 시도해 주세요.',
  github_error: 'GitHub 로그인에 실패했습니다. 잠시 뒤 다시 시도해 주세요.',
};

/** 이미 처리한 코드. 로그인 결과가 Custom Tab과 딥링크(auth 화면) 양쪽으로 들어와도 한 번만 쓴다 */
const handledCodes = new Set<string>();

/** metacode://auth?code= 또는 ?error=를 받아 로그인을 끝낸다 */
export async function completeSignIn(redirectUrl: string): Promise<void> {
  const params = new URL(redirectUrl).searchParams;
  const error = params.get('error');
  const code = params.get('code');
  if (error || !code) {
    useSession.setState({ loginError: LOGIN_ERRORS[error ?? ''] ?? LOGIN_ERRORS.github_error! });
    return;
  }
  if (handledCodes.has(code)) return;
  handledCodes.add(code);

  const codeVerifier = await SecureStore.getItemAsync(VERIFIER_KEY);
  if (!codeVerifier) {
    useSession.setState({ loginError: LOGIN_ERRORS.invalid_state! });
    return;
  }
  try {
    const { data } = await postJson<AuthTokens>('/auth/android/token', { code, codeVerifier });
    if (!data) {
      useSession.setState({ loginError: LOGIN_ERRORS.invalid_state! });
      return;
    }
    await saveTokens(data);
    await SecureStore.deleteItemAsync(VERIFIER_KEY);
    useSession.setState({ status: 'signedIn', loginError: null });
  } catch {
    useSession.setState({ loginError: '서버에 연결하지 못했습니다.' });
  }
}

/** 로그아웃: 서버에서 리프레시 토큰을 폐기하고 지운다 (서버에 닿지 않아도 이 기기에서는 지운다) */
export async function signOut(): Promise<void> {
  const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
  if (refreshToken) await postJson('/auth/logout', { refreshToken }).catch(() => undefined);
  await clearTokens();
  useSession.setState({ status: 'signedOut' });
}
