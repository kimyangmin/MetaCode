import type { MetaCodeDesktopBridge } from '@metacode/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_URL } from '../config';
import { ApiError, apiFetch } from './client';

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

const calls = (fetch: ReturnType<typeof vi.fn>) =>
  fetch.mock.calls.map(
    ([url, init]) =>
      `${(init as RequestInit | undefined)?.method ?? 'GET'} ${String(url).replace(API_URL, '')}`,
  );

describe('apiFetch (웹)', () => {
  let fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;

  beforeEach(() => {
    fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('window', {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('쿠키를 함께 보낸다', async () => {
    fetch.mockResolvedValueOnce(json(200, { ok: true }));
    await apiFetch('/users/me');
    expect(fetch.mock.calls[0]![1]).toMatchObject({ credentials: 'include' });
  });

  it('액세스 토큰이 만료(401)되면 세션을 갱신하고 다시 보낸다', async () => {
    fetch
      .mockResolvedValueOnce(json(401))
      .mockResolvedValueOnce(json(200)) // refresh
      .mockResolvedValueOnce(json(200, { username: 'alice' }));

    await expect(apiFetch('/users/me')).resolves.toEqual({ username: 'alice' });
    expect(calls(fetch)).toEqual(['GET /users/me', 'POST /auth/refresh', 'GET /users/me']);
  });

  it('동시에 여러 요청이 401을 받아도 갱신은 한 번만 한다', async () => {
    let releaseRefresh!: () => void;
    fetch.mockImplementation(async (url) => {
      if (String(url).endsWith('/auth/refresh')) {
        await new Promise<void>((r) => (releaseRefresh = r));
        return json(200);
      }
      return json(
        fetch.mock.calls.filter(([u]) => String(u).endsWith('/auth/refresh')).length ? 200 : 401,
        {},
      );
    });

    const both = Promise.all([apiFetch('/a'), apiFetch('/b')]);
    await vi.waitFor(() => expect(releaseRefresh).toBeDefined());
    releaseRefresh();
    await both;

    expect(calls(fetch).filter((c) => c === 'POST /auth/refresh')).toHaveLength(1);
  });

  it('갱신도 실패하면 한 번 더 보낸 뒤 401 오류를 던진다', async () => {
    fetch
      .mockResolvedValueOnce(json(401))
      .mockResolvedValueOnce(json(401)) // refresh
      .mockResolvedValueOnce(json(401, { message: '로그인이 필요합니다.' }));

    const error = await apiFetch('/users/me').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, message: '로그인이 필요합니다.' });
  });
});

describe('apiFetch (데스크톱)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Bearer 토큰을 붙이고 쿠키는 보내지 않으며, 401이어도 웹 갱신을 시도하지 않는다', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json(401));
    vi.stubGlobal('fetch', fetch);
    const bridge = {
      auth: { getAccessToken: vi.fn().mockResolvedValue('desktop-token') },
    } as unknown as MetaCodeDesktopBridge;
    vi.stubGlobal('window', { metacode: bridge });

    await expect(apiFetch('/users/me')).rejects.toMatchObject({ status: 401 });

    const init = fetch.mock.calls[0]![1]!;
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer desktop-token');
    expect(init.credentials).toBe('omit');
    expect(calls(fetch)).toEqual(['GET /users/me']);
  });
});
