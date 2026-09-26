import { createHash, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type {
  AuthTokens,
  ClientToServerEvents,
  ServerToClientEvents,
  UserProfile,
} from '@metacode/shared';
import { type Socket, io } from 'socket.io-client';
import { testEnv } from './env.js';
import { type FakeGithubUser, startFakeGithub } from './fake-github.js';

/** 가짜 GitHub에 연결된 실제 서버를 임의 포트로 띄운다. */
export async function startTestApp() {
  const github = await startFakeGithub(testEnv.GITHUB_CLIENT_ID, testEnv.GITHUB_CLIENT_SECRET);
  process.env.GITHUB_OAUTH_URL = github.url;
  process.env.GITHUB_API_URL = github.url;

  // 환경변수를 먼저 정한 뒤 불러와야 ConfigModule이 이 값으로 검증한다.
  const { AppModule } = await import('../src/app.module.js');
  const { setupApp } = await import('../src/app.setup.js');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app: INestApplication = moduleRef.createNestApplication();
  setupApp(app);
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    app,
    baseUrl,
    github,
    fetch: (path: string, init?: RequestInit) =>
      fetch(`${baseUrl}${path}`, { redirect: 'manual', ...init }),
    async close() {
      await app.close();
      await github.close();
    },
  };
}

export type TestApp = Awaited<ReturnType<typeof startTestApp>>;

/** Set-Cookie 헤더들 → { 이름: 값 } (값이 빈 쿠키는 삭제된 것으로 보고 제외) */
export function readSetCookies(res: Response): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const header of res.headers.getSetCookie()) {
    const [pair = ''] = header.split(';');
    const index = pair.indexOf('=');
    const value = decodeURIComponent(pair.slice(index + 1));
    if (value) cookies[pair.slice(0, index)] = value;
  }
  return cookies;
}

export function cookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');
}

let nextGithubId = 1000;

export function makeGithubUser(overrides: Partial<FakeGithubUser> = {}): FakeGithubUser {
  const id = nextGithubId++;
  return {
    id,
    login: `user${id}`,
    name: `User ${id}`,
    avatar_url: `https://avatars.githubusercontent.com/u/${id}`,
    ...overrides,
  };
}

/** 조건이 참이 될 때까지 잠깐씩 기다린다 (비동기 서버 처리 대기용). */
export async function eventually(check: () => Promise<boolean>, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('시간 안에 조건을 만족하지 못했습니다.');
}

export type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface TestUser {
  me: UserProfile;
  tokens: AuthTokens;
  /** Bearer 토큰을 붙인 요청 */
  fetch(path: string, init?: RequestInit): Promise<Response>;
  json<T>(path: string, init?: RequestInit): Promise<T>;
}

/** 데스크톱 방식(루프백 + PKCE)으로 새 사용자를 로그인시킨다. */
export async function loginUser(
  t: TestApp,
  overrides: Partial<FakeGithubUser> = {},
): Promise<TestUser> {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const start = await t.fetch(
    `/auth/github?client=desktop&code_challenge=${challenge}&redirect_port=51234`,
  );
  const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
  const user = makeGithubUser(overrides);
  t.github.addCode(`login-${user.id}`, user);
  const callback = await t.fetch(`/auth/github/callback?code=login-${user.id}&state=${state}`);
  const code = new URL(callback.headers.get('location')!).searchParams.get('code')!;
  const tokens = (await (
    await t.fetch('/auth/desktop/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, codeVerifier: verifier }),
    })
  ).json()) as AuthTokens;

  const authed = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${tokens.accessToken}`);
    if (init.body) headers.set('Content-Type', 'application/json');
    return t.fetch(path, { ...init, headers });
  };
  const json = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const res = await authed(path, init);
    if (!res.ok)
      throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  };
  return { me: await json<UserProfile>('/users/me'), tokens, fetch: authed, json };
}

/** 이 사용자로 실시간 연결을 연다. 연결이 끝나고 방에 들어갈 때까지 기다린다. */
export async function connectSocket(t: TestApp, user: TestUser): Promise<ClientSocket> {
  const socket: ClientSocket = io(t.baseUrl, {
    transports: ['websocket'],
    forceNew: true,
    auth: { token: user.tokens.accessToken },
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });
  // 서버의 handleConnection(방 참가)이 끝날 시간을 준다.
  await new Promise((r) => setTimeout(r, 150));
  return socket;
}

type EventArgs<E extends keyof ServerToClientEvents> = Parameters<ServerToClientEvents[E]>[0];

/** 조건에 맞는 이벤트가 올 때까지 기다린다. */
export function nextEvent<E extends keyof ServerToClientEvents>(
  socket: ClientSocket,
  event: E,
  predicate: (payload: EventArgs<E>) => boolean = () => true,
  timeoutMs = 3000,
): Promise<EventArgs<E>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler as never);
      reject(new Error(`${String(event)} 이벤트가 오지 않았습니다.`));
    }, timeoutMs);
    const handler = (payload: EventArgs<E>) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler as never);
      resolve(payload);
    };
    socket.on(event, handler as never);
  });
}

/** 일정 시간 동안 조건에 맞는 이벤트가 오지 않는지 확인한다. */
export async function expectNoEvent<E extends keyof ServerToClientEvents>(
  socket: ClientSocket,
  event: E,
  predicate: (payload: EventArgs<E>) => boolean = () => true,
  waitMs = 400,
): Promise<void> {
  let received = false;
  const handler = (payload: EventArgs<E>) => {
    if (predicate(payload)) received = true;
  };
  socket.on(event, handler as never);
  await new Promise((r) => setTimeout(r, waitMs));
  socket.off(event, handler as never);
  if (received) throw new Error(`${String(event)} 이벤트가 오면 안 됩니다.`);
}
