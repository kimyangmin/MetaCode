/**
 * 안드로이드 앱이 받는 metacode:// 주소 풀기 (앱의 intent-filter가 이 스킴을 받는다).
 * - metacode://auth?code=… / ?error=… : GitHub 로그인이 끝나고 서버가 돌려보낸 결과
 * - metacode://invite/<코드> : 초대 링크 (데스크톱과 같은 형식)
 * URL로 풀지 않고 글자 그대로 맞춘다 (new URL은 ../ 같은 경로를 풀어서 다른 주소가 통과할 수 있음).
 */
export type AppLink =
  | { kind: 'login'; code: string }
  | { kind: 'loginError'; reason: string }
  | { kind: 'navigate'; route: string };

const AUTH_LINK = /^metacode:\/\/auth\/?\?(code|error)=([A-Za-z0-9_-]{1,256})$/i;
const INVITE_LINK = /^metacode:\/\/invite\/([A-Za-z0-9]{4,32})\/?$/i;

export function parseAppLink(url: string): AppLink | null {
  const auth = AUTH_LINK.exec(url);
  if (auth) {
    return auth[1]!.toLowerCase() === 'code'
      ? { kind: 'login', code: auth[2]! }
      : { kind: 'loginError', reason: auth[2]! };
  }
  const invite = INVITE_LINK.exec(url);
  return invite ? { kind: 'navigate', route: `/invite/${invite[1]}` } : null;
}

/** PKCE code_verifier (RFC 7636): 32바이트 무작위 값을 base64url로 (43자) */
export function randomVerifier(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64url(bytes);
}

/** PKCE S256: base64url(sha256(verifier)) */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
