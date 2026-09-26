import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** URL에 그대로 쓸 수 있는 무작위 토큰 (기본 32바이트 = 256비트) */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Base64Url(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

/** PKCE S256: base64url(sha256(code_verifier)) === code_challenge */
export function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  const actual = Buffer.from(sha256Base64Url(codeVerifier));
  const expected = Buffer.from(codeChallenge);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
