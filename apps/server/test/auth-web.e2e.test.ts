import type { UserProfile } from '@metacode/shared';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testEnv } from './env.js';
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

/** 로그인 시작 → GitHub 인증(가짜) → 콜백까지 진행하고 콜백 응답을 돌려준다. */
async function loginWithGithub(user = makeGithubUser(), opts: { sendStateCookie?: boolean } = {}) {
  const start = await t.fetch('/auth/github?client=web');
  expect(start.status).toBe(302);
  const authorizeUrl = new URL(start.headers.get('location')!);
  expect(authorizeUrl.origin).toBe(t.github.url);
  expect(authorizeUrl.searchParams.get('client_id')).toBe(testEnv.GITHUB_CLIENT_ID);
  expect(authorizeUrl.searchParams.get('redirect_uri')).toBe(
    `${testEnv.PUBLIC_SERVER_URL}/auth/github/callback`,
  );

  const state = authorizeUrl.searchParams.get('state')!;
  const stateCookie = readSetCookies(start);
  const code = `code-${user.id}-${Math.random()}`;
  t.github.addCode(code, user);

  const callback = await t.fetch(`/auth/github/callback?code=${code}&state=${state}`, {
    headers: opts.sendStateCookie === false ? {} : { cookie: cookieHeader(stateCookie) },
  });
  return { callback, state, stateCookie, user };
}

describe('웹 GitHub 로그인', () => {
  it('로그인하면 HttpOnly 쿠키를 받고 웹으로 돌아가며, 쿠키로 내 프로필을 볼 수 있다', async () => {
    const { callback, user } = await loginWithGithub(
      makeGithubUser({ login: 'alice', name: 'Alice' }),
    );

    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe(testEnv.WEB_ORIGIN);
    const setCookies = callback.headers.getSetCookie();
    expect(setCookies.find((c) => c.startsWith('mc_access='))).toMatch(/HttpOnly/i);
    expect(setCookies.find((c) => c.startsWith('mc_refresh='))).toMatch(/Path=\/auth/);

    const me = await t.fetch('/users/me', {
      headers: { cookie: cookieHeader(readSetCookies(callback)) },
    });
    expect(me.status).toBe(200);
    expect((await me.json()) as UserProfile).toMatchObject({
      username: 'alice',
      displayName: 'Alice',
      avatarUrl: user.avatar_url,
    });
  });

  it('로그인 없이 내 프로필을 요청하면 401', async () => {
    expect((await t.fetch('/users/me')).status).toBe(401);
  });

  it('다시 로그인하면 GitHub의 바뀐 이름/아바타로 갱신되고 같은 사용자로 유지된다', async () => {
    const user = makeGithubUser({ name: '옛 이름' });
    const first = await loginWithGithub(user);
    const firstMe = (await (
      await t.fetch('/users/me', {
        headers: { cookie: cookieHeader(readSetCookies(first.callback)) },
      })
    ).json()) as UserProfile;

    const second = await loginWithGithub({ ...user, name: '새 이름', login: 'renamed' });
    const secondMe = (await (
      await t.fetch('/users/me', {
        headers: { cookie: cookieHeader(readSetCookies(second.callback)) },
      })
    ).json()) as UserProfile;

    expect(secondMe.id).toBe(firstMe.id);
    expect(secondMe).toMatchObject({ displayName: '새 이름', username: 'renamed' });
  });

  it('state 쿠키가 없는 콜백(다른 브라우저에서 만든 링크)은 로그인시키지 않는다', async () => {
    const { callback } = await loginWithGithub(makeGithubUser(), { sendStateCookie: false });
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe(
      `${testEnv.WEB_ORIGIN}/?login_error=invalid_state`,
    );
    expect(readSetCookies(callback)).not.toHaveProperty('mc_access');
  });

  it('한 번 쓴 state는 다시 쓸 수 없다', async () => {
    const { state, stateCookie } = await loginWithGithub();
    const replay = await t.fetch(`/auth/github/callback?code=anything&state=${state}`, {
      headers: { cookie: cookieHeader(stateCookie) },
    });
    expect(replay.status).toBe(400);
  });

  it('GitHub에서 거부하면 웹으로 돌아가 사유를 알려준다', async () => {
    const start = await t.fetch('/auth/github?client=web');
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const callback = await t.fetch(`/auth/github/callback?error=access_denied&state=${state}`, {
      headers: { cookie: cookieHeader(readSetCookies(start)) },
    });
    expect(callback.headers.get('location')).toBe(
      `${testEnv.WEB_ORIGIN}/?login_error=access_denied`,
    );
  });
});

describe('웹 세션 갱신과 로그아웃', () => {
  it('리프레시 쿠키로 새 쿠키를 받고, 로그아웃하면 더 이상 갱신할 수 없다', async () => {
    const { callback } = await loginWithGithub();
    const cookies = readSetCookies(callback);

    const refreshed = await t.fetch('/auth/refresh', {
      method: 'POST',
      headers: { cookie: cookieHeader({ mc_refresh: cookies.mc_refresh! }) },
    });
    expect(refreshed.status).toBe(200);
    const next = readSetCookies(refreshed);
    expect(next.mc_refresh).toBeDefined();
    expect(next.mc_refresh).not.toBe(cookies.mc_refresh);

    const logout = await t.fetch('/auth/logout', {
      method: 'POST',
      headers: { cookie: cookieHeader({ mc_refresh: next.mc_refresh! }) },
    });
    expect(logout.status).toBe(204);

    const afterLogout = await t.fetch('/auth/refresh', {
      method: 'POST',
      headers: { cookie: cookieHeader({ mc_refresh: next.mc_refresh! }) },
    });
    expect(afterLogout.status).toBe(401);
  });

  it('교체된 지 오래된 리프레시 토큰이 다시 쓰이면 그 로그인 세션 전체를 끊는다', async () => {
    const { callback } = await loginWithGithub();
    const original = readSetCookies(callback).mc_refresh!;

    const rotated = await t.fetch('/auth/refresh', {
      method: 'POST',
      headers: { cookie: cookieHeader({ mc_refresh: original }) },
    });
    const current = readSetCookies(rotated).mc_refresh!;

    // 동시 요청 허용 시간(30초)이 지난 것처럼 만든다.
    const db = new pg.Client({ connectionString: testEnv.DATABASE_URL });
    await db.connect();
    await db.query(
      `UPDATE refresh_tokens SET revoked_at = now() - interval '1 minute' WHERE revoked_at IS NOT NULL`,
    );
    await db.end();

    const reuse = await t.fetch('/auth/refresh', {
      method: 'POST',
      headers: { cookie: cookieHeader({ mc_refresh: original }) },
    });
    expect(reuse.status).toBe(401);

    const currentAfterReuse = await t.fetch('/auth/refresh', {
      method: 'POST',
      headers: { cookie: cookieHeader({ mc_refresh: current }) },
    });
    expect(currentAfterReuse.status).toBe(401);
  });

  it('방금 교체된 토큰의 재사용(동시 갱신)은 거절하되 세션은 끊지 않는다', async () => {
    const { callback } = await loginWithGithub();
    const original = readSetCookies(callback).mc_refresh!;

    const rotated = await t.fetch('/auth/refresh', {
      method: 'POST',
      headers: { cookie: cookieHeader({ mc_refresh: original }) },
    });
    const current = readSetCookies(rotated).mc_refresh!;

    const concurrent = await t.fetch('/auth/refresh', {
      method: 'POST',
      headers: { cookie: cookieHeader({ mc_refresh: original }) },
    });
    expect(concurrent.status).toBe(401);

    const stillValid = await t.fetch('/auth/refresh', {
      method: 'POST',
      headers: { cookie: cookieHeader({ mc_refresh: current }) },
    });
    expect(stillValid.status).toBe(200);
  });
});
