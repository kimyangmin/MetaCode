import { describe, expect, it } from 'vitest';
import { parseAppLink, pkceChallenge, randomVerifier } from './appLinks';

describe('parseAppLink', () => {
  it('로그인 결과와 초대 링크를 푼다', () => {
    expect(parseAppLink('metacode://auth?code=abc_DEF-123')).toEqual({
      kind: 'login',
      code: 'abc_DEF-123',
    });
    expect(parseAppLink('metacode://auth?error=access_denied')).toEqual({
      kind: 'loginError',
      reason: 'access_denied',
    });
    expect(parseAppLink('metacode://invite/Ab12Cd34')).toEqual({
      kind: 'navigate',
      route: '/invite/Ab12Cd34',
    });
  });

  it('다른 주소나 이상한 값은 받지 않는다', () => {
    for (const url of [
      'metacode://invite/../c/abc',
      'metacode://invite/ab',
      'metacode://auth?code=a&code=b',
      'metacode://auth?code=<script>',
      'metacode://settings',
      'https://metacode.kimyangmin.me/invite/Ab12Cd34',
    ]) {
      expect(parseAppLink(url)).toBeNull();
    }
  });
});

describe('PKCE', () => {
  it('verifier는 43자 base64url이고, challenge는 서버와 같은 S256이다', async () => {
    expect(randomVerifier()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomVerifier()).not.toBe(randomVerifier());
    // 기대값은 Node의 createHash('sha256').digest('base64url')로 구한 것 (서버의 verifyPkce와 같은 계산)
    expect(await pkceChallenge('dBjftJeZ4CVP-mJ92K9lGiY1FjR3Pmm6wS36N0sbdoY')).toBe(
      'K43wCrq5dod5dFsoCrUnLgYToCZ-D7jkLzC1Qv1hLdU',
    );
  });
});
