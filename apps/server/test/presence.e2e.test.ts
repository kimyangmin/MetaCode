import { createHash, randomBytes } from 'node:crypto';
import type { AuthTokens, PresenceResponse, UserProfile } from '@metacode/shared';
import { type Socket, io } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type TestApp, eventually, makeGithubUser, startTestApp } from './harness.js';

let t: TestApp;
const sockets: Socket[] = [];

beforeAll(async () => {
  t = await startTestApp();
});

afterEach(() => {
  for (const s of sockets.splice(0)) s.disconnect();
});

afterAll(async () => {
  await t.close();
});

/** 데스크톱 로그인으로 토큰과 프로필을 받는다. */
async function login(): Promise<{ tokens: AuthTokens; me: UserProfile }> {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const start = await t.fetch(
    `/auth/github?client=desktop&code_challenge=${challenge}&redirect_port=51234`,
  );
  const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
  const user = makeGithubUser();
  t.github.addCode(`p-${user.id}`, user);
  const callback = await t.fetch(`/auth/github/callback?code=p-${user.id}&state=${state}`);
  const code = new URL(callback.headers.get('location')!).searchParams.get('code')!;
  const tokens = (await (
    await t.fetch('/auth/desktop/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, codeVerifier: verifier }),
    })
  ).json()) as AuthTokens;
  const me = (await (
    await t.fetch('/users/me', { headers: { authorization: `Bearer ${tokens.accessToken}` } })
  ).json()) as UserProfile;
  return { tokens, me };
}

function connect(options: Parameters<typeof io>[1]): Promise<Socket> {
  const socket = io(t.baseUrl, { transports: ['websocket'], forceNew: true, ...options });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

async function isOnline(userId: string, accessToken: string): Promise<boolean> {
  const res = await t.fetch(`/presence?userIds=${userId}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return ((await res.json()) as PresenceResponse)[userId] === true;
}

describe('온라인 상태 (Presence)', () => {
  it('연결이 하나라도 있으면 온라인, 모두 끊기면 오프라인', async () => {
    const { tokens, me } = await login();
    expect(await isOnline(me.id, tokens.accessToken)).toBe(false);

    const tab1 = await connect({ auth: { token: tokens.accessToken } });
    const tab2 = await connect({ auth: { token: tokens.accessToken } });
    await eventually(() => isOnline(me.id, tokens.accessToken));

    tab1.disconnect();
    await new Promise((r) => setTimeout(r, 200));
    expect(await isOnline(me.id, tokens.accessToken)).toBe(true);

    tab2.disconnect();
    await eventually(async () => !(await isOnline(me.id, tokens.accessToken)));
  });

  it('웹처럼 쿠키로 인증한 연결도 온라인으로 센다', async () => {
    const { tokens, me } = await login();
    await connect({ extraHeaders: { cookie: `mc_access=${tokens.accessToken}` } });
    await eventually(() => isOnline(me.id, tokens.accessToken));
  });

  it('토큰이 없거나 틀리면 연결을 끊는다', async () => {
    for (const auth of [{}, { token: 'not-a-jwt' }]) {
      const socket = io(t.baseUrl, { transports: ['websocket'], forceNew: true, auth });
      sockets.push(socket);
      await new Promise<void>((resolve) => socket.once('disconnect', () => resolve()));
      expect(socket.connected).toBe(false);
    }
  });

  it('존재하지 않는 형식의 사용자 ID로 조회하면 400', async () => {
    const { tokens } = await login();
    const res = await t.fetch('/presence?userIds=not-a-uuid', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(res.status).toBe(400);
  });
});
