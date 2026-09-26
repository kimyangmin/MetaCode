import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
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
