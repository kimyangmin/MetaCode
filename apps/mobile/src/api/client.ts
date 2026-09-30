import { API_URL } from '../config';
import { NetworkError, getAccessToken } from '../auth/session';

/** 서버가 돌려준 오류. status 0은 서버에 닿지 않은 것이다 (웹 api/client.ts와 같은 모양) */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function authorizedFetch(path: string, init: RequestInit, force: boolean): Promise<Response> {
  let token: string;
  try {
    token = await getAccessToken(force);
  } catch (error) {
    if (error instanceof NetworkError) throw new ApiError(0, error.message);
    throw new ApiError(401, '로그인이 필요합니다.');
  }
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  try {
    return await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, '서버에 연결하지 못했습니다.');
  }
}

/**
 * 서버 API 호출 (Bearer 토큰). 액세스 토큰이 만료(401)되었으면 한 번 갱신하고 다시 보낸다.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await authorizedFetch(path, init, false);
  if (res.status === 401) res = await authorizedFetch(path, init, true);

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

/** JSON 본문을 보내는 요청 */
export function apiSend<T>(path: string, method: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
