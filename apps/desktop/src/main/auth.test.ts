import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthManager, type TokenStorage } from './auth';

const API = 'http://api.test';

function memoryStorage(initial: string | null = null): TokenStorage & { value: string | null } {
  return {
    value: initial,
    load() {
      return this.value;
    },
    save(token) {
      this.value = token;
    },
  };
}

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

function tokens(n: number, expiresIn = 900) {
  return {
    accessToken: `access-${n}`,
    accessTokenExpiresIn: expiresIn,
    refreshToken: `refresh-${n}`,
  };
}

describe('AuthManager', () => {
  let storage: ReturnType<typeof memoryStorage>;
  let fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;
  let openExternal: ReturnType<typeof vi.fn<(url: string) => Promise<void>>>;
  let onChanged: ReturnType<typeof vi.fn<() => void>>;
  let onReturned: ReturnType<typeof vi.fn<() => void>>;

  const create = () =>
    new AuthManager({ apiUrl: API, storage, fetch, openExternal, onChanged, onReturned });

  const bodyOf = (call: number) =>
    JSON.parse(fetch.mock.calls[call]![1]!.body as string) as Record<string, string>;

  beforeEach(() => {
    storage = memoryStorage();
    fetch = vi.fn<typeof globalThis.fetch>();
    openExternal = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
    onChanged = vi.fn<() => void>();
    onReturned = vi.fn<() => void>();
  });

  /** 로그인을 시작하고, 브라우저가 열려던 주소와 앱이 기다리는 루프백 포트를 돌려준다. */
  async function startLogin(auth: AuthManager) {
    await auth.login();
    const opened = new URL(openExternal.mock.calls.at(-1)![0]);
    return { opened, port: Number(opened.searchParams.get('redirect_port')) };
  }

  /** 서버가 로그인 후 브라우저를 루프백 주소로 보낸 것처럼 요청한다. */
  function browserReturns(port: number, query: string) {
    return globalThis.fetch(`http://127.0.0.1:${port}/callback?${query}`);
  }

  it('로그인: challenge와 루프백 포트를 보내고, 돌아온 code를 같은 verifier로 교환한다', async () => {
    const auth = create();
    const { opened, port } = await startLogin(auth);
    expect(opened.href.startsWith(`${API}/auth/github?`)).toBe(true);
    expect(opened.searchParams.get('client')).toBe('desktop');
    expect(port).toBeGreaterThan(0);
    const challenge = opened.searchParams.get('code_challenge')!;

    fetch.mockResolvedValueOnce(json(200, tokens(1)));
    const page = await browserReturns(port, 'code=abc');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('로그인되었습니다');
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));

    expect(String(fetch.mock.calls[0]![0])).toBe(`${API}/auth/desktop/token`);
    const { code, codeVerifier } = bodyOf(0);
    expect(code).toBe('abc');
    expect(createHash('sha256').update(codeVerifier!).digest('base64url')).toBe(challenge);

    expect(await auth.getAccessToken()).toBe('access-1');
    expect(storage.value).toBe('refresh-1');
    expect(onReturned).toHaveBeenCalledTimes(1);
  });

  it('결과를 받으면 루프백을 바로 닫는다 (두 번째 요청은 연결조차 안 된다)', async () => {
    const auth = create();
    const { port } = await startLogin(auth);
    fetch.mockResolvedValueOnce(json(200, tokens(1)));
    await browserReturns(port, 'code=abc');
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());

    await expect(browserReturns(port, 'code=again')).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('로그인 실패(?error=)는 토큰 없이 상태 변경만 알린다', async () => {
    const auth = create();
    const { port } = await startLogin(auth);
    const page = await browserReturns(port, 'error=access_denied');
    expect(await page.text()).toContain('로그인하지 못했습니다');
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(fetch).not.toHaveBeenCalled();
    expect(auth.isLoggedIn()).toBe(false);
  });

  it('로그인을 다시 시작하면 이전 루프백은 닫힌다', async () => {
    const auth = create();
    const first = await startLogin(auth);
    const second = await startLogin(auth);
    expect(second.port).not.toBe(first.port);
    await expect(browserReturns(first.port, 'code=old')).rejects.toThrow();
    auth.dispose();
  });

  it('콜백이 아닌 경로(favicon 등)는 무시하고 계속 기다린다', async () => {
    const auth = create();
    const { port } = await startLogin(auth);
    expect((await globalThis.fetch(`http://127.0.0.1:${port}/favicon.ico`)).status).toBe(404);
    fetch.mockResolvedValueOnce(json(200, tokens(1)));
    await browserReturns(port, 'code=abc');
    await vi.waitFor(() => expect(auth.isLoggedIn()).toBe(true));
  });

  it('저장된 리프레시 토큰으로 액세스 토큰을 받고, 동시에 불려도 한 번만 갱신한다', async () => {
    storage = memoryStorage('refresh-0');
    const auth = create();
    fetch.mockResolvedValueOnce(json(200, tokens(1)));

    const [a, b] = await Promise.all([auth.getAccessToken(), auth.getAccessToken()]);

    expect(a).toBe('access-1');
    expect(b).toBe('access-1');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(bodyOf(0)).toEqual({ refreshToken: 'refresh-0' });
    expect(storage.value).toBe('refresh-1');
  });

  it('만료가 가까운 액세스 토큰은 미리 갱신한다', async () => {
    storage = memoryStorage('refresh-0');
    const auth = create();
    fetch.mockResolvedValueOnce(json(200, tokens(1, 10))); // 10초 뒤 만료
    fetch.mockResolvedValueOnce(json(200, tokens(2)));

    expect(await auth.getAccessToken()).toBe('access-1');
    expect(await auth.getAccessToken()).toBe('access-2');
  });

  it('세션이 끊겼으면(401) 토큰을 지우고 로그아웃 상태로 알린다', async () => {
    storage = memoryStorage('refresh-0');
    const auth = create();
    fetch.mockResolvedValueOnce(json(401));

    expect(await auth.getAccessToken()).toBeNull();
    expect(storage.value).toBeNull();
    expect(auth.isLoggedIn()).toBe(false);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('네트워크 오류로 갱신에 실패하면 토큰을 지우지 않는다', async () => {
    storage = memoryStorage('refresh-0');
    const auth = create();
    fetch.mockRejectedValueOnce(new TypeError('fetch failed'));

    expect(await auth.getAccessToken()).toBeNull();
    expect(storage.value).toBe('refresh-0');
    expect(auth.isLoggedIn()).toBe(true);
  });

  it('로그아웃하면 서버에 리프레시 토큰을 보내 세션을 끊고 저장소를 비운다', async () => {
    storage = memoryStorage('refresh-0');
    const auth = create();
    fetch.mockResolvedValueOnce(json(204));

    await auth.logout();

    expect(String(fetch.mock.calls[0]![0])).toBe(`${API}/auth/logout`);
    expect(bodyOf(0)).toEqual({ refreshToken: 'refresh-0' });
    expect(storage.value).toBeNull();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});
