import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({}));
const { bytesToBase64Url, toBase64Url } = await import('./pkce');

describe('PKCE 인코딩', () => {
  it('base64를 base64url로 바꾸고 끝의 =를 뺀다', () => {
    expect(toBase64Url('a+b/c==')).toBe('a-b_c');
  });

  it('32바이트 verifier는 43자이고 서버가 받는 글자만 쓴다', () => {
    const verifier = bytesToBase64Url(new Uint8Array(32).map((_, i) => i * 8));
    expect(verifier).toHaveLength(43);
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });
});
