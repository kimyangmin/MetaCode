import { API_URL } from '../config';
import { getDesktopBridge } from '../platform';

/** 서버가 돌려준 오류. status 0은 서버에 닿지 않은 것이다 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;

/** 웹: 리프레시 쿠키로 새 쿠키를 받는다. 동시에 여러 요청이 401을 받아도 한 번만 갱신한다. */
export function refreshWebSession(): Promise<boolean> {
  refreshing ??= fetch(`${API_URL}/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/**
 * 서버 API 호출. 웹은 HttpOnly 쿠키, 데스크톱은 메인 프로세스가 준 Bearer 토큰으로 인증한다.
 * 웹에서 액세스 토큰이 만료(401)되면 한 번 갱신하고 다시 보낸다.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const desktop = getDesktopBridge();

  const send = async () => {
    const headers = new Headers(init.headers);
    if (desktop) {
      // 로그인은 되어 있지만 서버에 닿지 않으면 메인 프로세스가 거절한다 (로그아웃과 구분).
      const token = await desktop.auth.getAccessToken().catch(() => {
        throw new ApiError(0, '서버에 연결하지 못했습니다.');
      });
      if (token) headers.set('Authorization', `Bearer ${token}`);
    }
    return fetch(`${API_URL}${path}`, {
      ...init,
      headers,
      credentials: desktop ? 'omit' : 'include',
    });
  };

  let res = await send();
  if (res.status === 401 && !desktop) {
    // 갱신이 실패해도 다시 보내 본다: 다른 탭이 방금 갱신했다면 새 쿠키가 이미 들어와 있다.
    await refreshWebSession();
    res = await send();
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
    throw new ApiError(
      res.status,
      typeof body?.message === 'string' ? body.message : `요청 실패 (${res.status})`,
    );
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') return undefined as T;
  return (await res.json()) as T;
}
