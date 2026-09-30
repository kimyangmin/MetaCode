import { createHash, randomBytes } from 'node:crypto';
import type { AuthTokens, UserProfile } from '@metacode/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type TestApp,
  cookieHeader,
  makeGithubUser,
  readSetCookies,
  startTestApp,
} from './harness.js';

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

/** 로그인 시작 → GitHub(가짜) → 콜백까지 진행하고 콜백 응답을 돌려준다. */
async function githubCallback(start: string, query: (githubCode: string) => string) {
  const res = await t.fetch(start);
  expect(res.status).toBe(302);
  const state = new URL(res.headers.get('location')!).searchParams.get('state')!;
  const user = makeGithubUser();
  const githubCode = `app-${user.id}`;
  t.github.addCode(githubCode, user);
  return t.fetch(`/auth/github/callback?${query(githubCode)}&state=${state}`);
}

/** 앱으로 돌려보내는 페이지에서 metacode://auth 주소를 꺼낸다 */
async function appRedirect(res: Response): Promise<URL> {
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('no-store');
  const html = await res.text();
  const href = /href="(metacode:\/\/auth\?[^"]+)"/.exec(html)?.[1];
  expect(href).toBeDefined();
  return new URL(href!.replace(/&amp;/g, '&'));
}

async function androidCode(challenge: string): Promise<string> {
  const callback = await githubCallback(
    `/auth/github?client=android&code_challenge=${challenge}`,
    (code) => `code=${code}`,
  );
  // 앱에 가기 전에는 쿠키를 심지 않는다 (시스템 브라우저의 쿠키이므로).
  expect(readSetCookies(callback)).toEqual({});
  return (await appRedirect(callback)).searchParams.get('code')!;
}

const session = (code: string, codeVerifier: string) =>
  t.fetch('/auth/android/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, codeVerifier }),
  });

describe('안드로이드 GitHub 로그인 (딥링크 + PKCE)', () => {
  it('딥링크로 받은 코드와 verifier로 웹과 같은 로그인 쿠키를 받는다', async () => {
    const { verifier, challenge } = pkcePair();
    const res = await session(await androidCode(challenge), verifier);
    expect(res.status).toBe(204);
    const cookies = readSetCookies(res);
    expect(Object.keys(cookies).sort()).toEqual(['mc_access', 'mc_refresh']);

    const me = await t.fetch('/users/me', { headers: { cookie: cookieHeader(cookies) } });
    expect(me.status).toBe(200);
    expect(((await me.json()) as UserProfile).username).toMatch(/^user\d+$/);

    // 이후 갱신은 웹과 같이 쿠키로 한다.
    const refreshed = await t.fetch('/auth/refresh', {
      method: 'POST',
      headers: { cookie: cookieHeader({ mc_refresh: cookies.mc_refresh! }) },
    });
    expect(refreshed.status).toBe(200);
    expect(readSetCookies(refreshed).mc_refresh).toBeDefined();
  });

  it('네이티브 앱은 같은 코드로 토큰을 받아 Bearer로 쓰고, 본문으로 갱신한다', async () => {
    const { verifier, challenge } = pkcePair();
    const code = await androidCode(challenge);
    const res = await t.fetch('/auth/android/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, codeVerifier: verifier }),
    });
    expect(res.status).toBe(200);
    expect(readSetCookies(res)).toEqual({});
    const tokens = (await res.json()) as AuthTokens;

    const me = await t.fetch('/users/me', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(me.status).toBe(200);

    const refreshed = await t.fetch('/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    });
    expect(refreshed.status).toBe(200);
    expect(((await refreshed.json()) as AuthTokens).refreshToken).not.toBe(tokens.refreshToken);

    // 코드는 한 번만 쓸 수 있다 (쿠키 쪽으로도 다시 못 씀).
    expect((await session(code, verifier)).status).toBe(401);
  });

  it('verifier가 틀리거나 코드를 다시 쓰면 거절한다', async () => {
    const { verifier, challenge } = pkcePair();
    const code = await androidCode(challenge);
    expect((await session(code, pkcePair().verifier)).status).toBe(401);
    // 틀린 시도에도 코드는 없어진다 (한 번만 쓸 수 있음).
    expect((await session(code, verifier)).status).toBe(401);
  });

  it('데스크톱 코드와 안드로이드 코드는 서로 바꿔 쓸 수 없다', async () => {
    const { verifier, challenge } = pkcePair();
    const android = await androidCode(challenge);
    const asDesktop = await t.fetch('/auth/desktop/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: android, codeVerifier: verifier }),
    });
    expect(asDesktop.status).toBe(401);

    const desktop = pkcePair();
    const callback = await githubCallback(
      `/auth/github?client=desktop&code_challenge=${desktop.challenge}&redirect_port=51234`,
      (code) => `code=${code}`,
    );
    const desktopCode = new URL(callback.headers.get('location')!).searchParams.get('code')!;
    expect((await session(desktopCode, desktop.verifier)).status).toBe(401);
    // 데스크톱 쪽에서는 그대로 쓸 수 있다.
    const tokens = await t.fetch('/auth/desktop/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: desktopCode, codeVerifier: desktop.verifier }),
    });
    expect(((await tokens.json()) as AuthTokens).accessToken).toBeTruthy();
  });

  it('code_challenge 없이는 시작할 수 없고, GitHub에서 거부하면 딥링크로 사유를 알려준다', async () => {
    expect((await t.fetch('/auth/github?client=android')).status).toBe(400);
    const callback = await githubCallback(
      `/auth/github?client=android&code_challenge=${pkcePair().challenge}`,
      () => 'error=access_denied',
    );
    expect((await appRedirect(callback)).href).toBe('metacode://auth?error=access_denied');
  });
});
