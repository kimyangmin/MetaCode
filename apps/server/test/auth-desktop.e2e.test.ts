import { createHash, randomBytes } from 'node:crypto';
import type { AuthTokens, UserProfile } from '@metacode/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestApp, makeGithubUser, readSetCookies, startTestApp } from './harness.js';

let t: TestApp;

beforeAll(async () => {
  t = await startTestApp();
});

afterAll(async () => {
  await t.close();
});

function pkcePair() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

const LOOPBACK_PORT = 51234;

/** 데스크톱 로그인 시작 → GitHub(가짜) → 콜백까지 진행하고, 앱 루프백 주소로 보내는 응답을 돌려준다. */
async function desktopCallback(challenge: string, query: (githubCode: string) => string) {
  const start = await t.fetch(
    `/auth/github?client=desktop&code_challenge=${challenge}&redirect_port=${LOOPBACK_PORT}`,
  );
  expect(start.status).toBe(302);
  // 데스크톱은 시스템 브라우저에서 진행되고 결과를 루프백으로 받으므로 state 쿠키를 쓰지 않는다.
  expect(readSetCookies(start)).toEqual({});
  const state = new URL(start.headers.get('location')!).searchParams.get('state')!;

  const user = makeGithubUser();
  const githubCode = `desktop-${user.id}`;
  t.github.addCode(githubCode, user);
  return t.fetch(`/auth/github/callback?${query(githubCode)}&state=${state}`);
}

/** 데스크톱 로그인을 끝까지 진행하고, 루프백으로 넘어간 code를 돌려준다. */
async function desktopLoginUntilLoopback(challenge: string) {
  const callback = await desktopCallback(challenge, (code) => `code=${code}`);
  expect(callback.status).toBe(302);
  expect(readSetCookies(callback)).toEqual({});
  const loopback = new URL(callback.headers.get('location')!);
  // 서버는 127.0.0.1의 요청받은 포트로만 돌려보낸다.
  expect(`${loopback.origin}${loopback.pathname}`).toBe(
    `http://127.0.0.1:${LOOPBACK_PORT}/callback`,
  );
  return loopback.searchParams.get('code')!;
}

async function exchange(code: string, codeVerifier: string) {
  return t.fetch('/auth/desktop/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, codeVerifier }),
  });
}

describe('데스크톱 GitHub 로그인 (루프백 + PKCE)', () => {
  it('루프백으로 받은 코드와 verifier로 토큰을 받고, Bearer로 프로필을 본다', async () => {
    const { verifier, challenge } = pkcePair();
    const code = await desktopLoginUntilLoopback(challenge);

    const res = await exchange(code, verifier);
    expect(res.status).toBe(200);
    const tokens = (await res.json()) as AuthTokens;
    expect(tokens.accessTokenExpiresIn).toBe(900);

    const me = await t.fetch('/users/me', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(((await me.json()) as UserProfile).username).toMatch(/^user\d+$/);
  });

  it('verifier가 틀리면 거절한다 (code를 알아낸 다른 프로그램은 토큰을 받을 수 없다)', async () => {
    const { challenge } = pkcePair();
    const code = await desktopLoginUntilLoopback(challenge);
    const res = await exchange(code, pkcePair().verifier);
    expect(res.status).toBe(401);
  });

  it('로그인 코드는 한 번만 쓸 수 있다', async () => {
    const { verifier, challenge } = pkcePair();
    const code = await desktopLoginUntilLoopback(challenge);
    expect((await exchange(code, verifier)).status).toBe(200);
    expect((await exchange(code, verifier)).status).toBe(401);
  });

  it('code_challenge나 올바른 루프백 포트 없이는 데스크톱 로그인을 시작할 수 없다', async () => {
    const { challenge } = pkcePair();
    for (const query of [
      `redirect_port=${LOOPBACK_PORT}`,
      `code_challenge=${challenge}`,
      `code_challenge=${challenge}&redirect_port=80`,
      `code_challenge=${challenge}&redirect_port=abc`,
    ]) {
      expect((await t.fetch(`/auth/github?client=desktop&${query}`)).status).toBe(400);
    }
  });

  it('GitHub에서 거부하면 루프백 주소로 사유를 알려준다', async () => {
    const callback = await desktopCallback(pkcePair().challenge, () => 'error=access_denied');
    expect(callback.headers.get('location')).toBe(
      `http://127.0.0.1:${LOOPBACK_PORT}/callback?error=access_denied`,
    );
  });

  it('리프레시 토큰을 본문으로 보내 교체하고, 로그아웃하면 끊긴다', async () => {
    const { verifier, challenge } = pkcePair();
    const tokens = (await (
      await exchange(await desktopLoginUntilLoopback(challenge), verifier)
    ).json()) as AuthTokens;

    const refreshed = await t.fetch('/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    });
    expect(refreshed.status).toBe(200);
    const next = (await refreshed.json()) as AuthTokens;
    expect(next.refreshToken).not.toBe(tokens.refreshToken);
    // 데스크톱 요청에는 쿠키를 심지 않는다.
    expect(readSetCookies(refreshed)).toEqual({});

    const logout = await t.fetch('/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: next.refreshToken }),
    });
    expect(logout.status).toBe(204);

    const afterLogout = await t.fetch('/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: next.refreshToken }),
    });
    expect(afterLogout.status).toBe(401);
  });
});
