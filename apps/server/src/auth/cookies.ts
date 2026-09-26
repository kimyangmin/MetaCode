import type { CookieOptions } from 'express';
import { ACCESS_TOKEN_TTL_SECONDS } from './access-token.service.js';
import { REFRESH_TOKEN_TTL_SECONDS } from './session.service.js';

export const ACCESS_COOKIE = 'mc_access';
export const REFRESH_COOKIE = 'mc_refresh';
export const OAUTH_STATE_COOKIE = 'mc_oauth_state';

/** 웹 로그인 쿠키. 운영(https)에서는 Secure를 붙인다. */
export function authCookieOptions(secure: boolean) {
  const base: CookieOptions = { httpOnly: true, sameSite: 'lax', secure };
  return {
    access: { ...base, path: '/', maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000 },
    // 리프레시 토큰은 /auth 아래(refresh, logout)로만 보낸다.
    refresh: { ...base, path: '/auth', maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000 },
    oauthState: { ...base, path: '/auth/github', maxAge: 10 * 60 * 1000 },
  } satisfies Record<string, CookieOptions>;
}

/** Cookie 헤더에서 값 하나를 꺼낸다 (WebSocket 핸드셰이크용). */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return undefined;
}
