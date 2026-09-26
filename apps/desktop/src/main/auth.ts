import { createHash, randomBytes } from 'node:crypto';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AuthTokens } from '@metacode/shared';

// @metacode/shared는 ESM이라 CommonJS인 메인 프로세스에서는 타입만 가져온다. 값은 같게 맞춘다.
const LOOPBACK_HOST = '127.0.0.1';
const LOOPBACK_PATH = '/callback';

/** 브라우저에서 로그인을 마칠 때까지 기다리는 최대 시간 */
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

/** 만료 이만큼 전에 미리 갱신한다. */
const EXPIRY_MARGIN_MS = 30 * 1000;

/** 리프레시 토큰 영구 보관소. 구현은 OS 암호화 저장소(safeStorage)를 쓴다. */
export interface TokenStorage {
  load(): string | null;
  save(refreshToken: string | null): void;
}

export interface AuthManagerDeps {
  apiUrl: string;
  storage: TokenStorage;
  openExternal(url: string): Promise<void>;
  /** 로그인 상태가 바뀌면 렌더러에 알린다. */
  onChanged(): void;
  /** 브라우저에서 로그인 결과가 돌아왔을 때 (앱 창을 앞으로 가져온다) */
  onReturned?(): void;
  fetch?: typeof fetch;
  /** 진단용 로그. 토큰이나 코드 값은 넘기지 않는다. */
  log?(message: string): void;
}

/**
 * 데스크톱 로그인 흐름 (메인 프로세스, RFC 8252 루프백 리디렉션)
 * 1. login(): PKCE verifier를 만들고 127.0.0.1의 임의 포트에서 결과를 기다리며,
 *    시스템 브라우저로 GitHub 로그인을 연다.
 * 2. 로그인이 끝나면 서버가 브라우저를 http://127.0.0.1:<port>/callback?code=... 로 보낸다.
 *    커스텀 스킴(metacode://)과 달리 브라우저의 "앱 열기" 확인이 필요 없어 어느 브라우저에서나 동작한다.
 * 3. code + verifier를 토큰으로 바꾼다. verifier는 이 프로세스만 알기 때문에
 *    다른 프로그램이 code를 알아내도 토큰을 받을 수 없다.
 */
export class AuthManager {
  private loopback: { server: Server; timer: NodeJS.Timeout } | null = null;
  private access: { token: string; expiresAt: number } | null = null;
  private refreshToken: string | null;
  private refreshing: Promise<string | null> | null = null;
  private readonly fetch: typeof fetch;

  constructor(private readonly deps: AuthManagerDeps) {
    this.refreshToken = deps.storage.load();
    this.fetch = deps.fetch ?? globalThis.fetch;
  }

  async login(): Promise<void> {
    // 이전에 시작하고 끝내지 않은 로그인은 버린다.
    this.stopLoopback();

    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');

    const server = createServer((req, res) => void this.onLoopbackRequest(req, res, verifier));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, LOOPBACK_HOST, resolve);
    });
    const timer = setTimeout(() => this.stopLoopback(), LOGIN_TIMEOUT_MS);
    timer.unref();
    this.loopback = { server, timer };
    const { port } = server.address() as AddressInfo;

    const url = new URL('/auth/github', this.deps.apiUrl);
    url.search = new URLSearchParams({
      client: 'desktop',
      code_challenge: challenge,
      redirect_port: String(port),
    }).toString();
    this.deps.log?.(`로그인 시작: 127.0.0.1:${port}에서 결과를 기다립니다`);
    await this.deps.openExternal(url.href);
  }

  isLoggedIn(): boolean {
    return this.refreshToken !== null;
  }

  /** 유효한 액세스 토큰. 만료가 가까우면 갱신한다. 동시에 불려도 갱신은 한 번만 한다. */
  getAccessToken(): Promise<string | null> {
    if (this.access && this.access.expiresAt - EXPIRY_MARGIN_MS > Date.now()) {
      return Promise.resolve(this.access.token);
    }
    if (!this.refreshToken) return Promise.resolve(null);
    this.refreshing ??= this.refresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  async logout(): Promise<void> {
    const token = this.refreshToken;
    this.clear();
    this.deps.onChanged();
    if (token) await this.post('/auth/logout', { refreshToken: token });
  }

  /** 앱 종료 시 기다리던 로그인을 정리한다. */
  dispose(): void {
    this.stopLoopback();
  }

  private async onLoopbackRequest(req: IncomingMessage, res: ServerResponse, verifier: string) {
    const url = new URL(req.url ?? '/', `http://${LOOPBACK_HOST}`);
    // 브라우저가 함께 요청하는 favicon 등은 무시한다.
    if (req.method !== 'GET' || url.pathname !== LOOPBACK_PATH) {
      res.writeHead(404).end();
      return;
    }

    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(resultPage(code ? '로그인되었습니다.' : '로그인하지 못했습니다.'));
    // 결과는 한 번만 받는다.
    this.stopLoopback();
    this.deps.onReturned?.();

    this.deps.log?.(`로그인 결과 수신: ${code ? 'code 있음' : `실패 (${error ?? '알 수 없음'})`}`);
    if (code) {
      const tokenRes = await this.post('/auth/desktop/token', { code, codeVerifier: verifier });
      this.deps.log?.(`토큰 교환: ${tokenRes ? tokenRes.status : '네트워크 오류'}`);
      if (tokenRes?.ok) this.setTokens((await tokenRes.json()) as AuthTokens);
    }
    this.deps.onChanged();
  }

  private stopLoopback(): void {
    if (!this.loopback) return;
    clearTimeout(this.loopback.timer);
    this.loopback.server.close();
    // 브라우저가 연결을 유지(keep-alive)하고 있어도 바로 닫는다.
    this.loopback.server.closeAllConnections();
    this.loopback = null;
  }

  private async refresh(): Promise<string | null> {
    const res = await this.post('/auth/refresh', { refreshToken: this.refreshToken });
    if (!res) return null; // 네트워크 오류: 토큰은 그대로 두고 다음에 다시 시도한다.
    if (res.status === 401) {
      // 세션이 끊겼다(로그아웃, 만료, 탈취 감지). 로그인 화면으로 돌아간다.
      this.clear();
      this.deps.onChanged();
      return null;
    }
    if (!res.ok) return null;
    this.setTokens((await res.json()) as AuthTokens);
    return this.access!.token;
  }

  private async post(path: string, body: unknown): Promise<Response | null> {
    try {
      return await this.fetch(new URL(path, this.deps.apiUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      return null;
    }
  }

  private setTokens(tokens: AuthTokens): void {
    this.access = {
      token: tokens.accessToken,
      expiresAt: Date.now() + tokens.accessTokenExpiresIn * 1000,
    };
    this.refreshToken = tokens.refreshToken;
    this.deps.storage.save(tokens.refreshToken);
  }

  private clear(): void {
    this.access = null;
    this.refreshToken = null;
    this.deps.storage.save(null);
  }
}

function resultPage(title: string): string {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MetaCode</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, 'Malgun Gothic', sans-serif; }
  body { display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 16px; box-sizing: border-box; text-align: center; }
</style>
</head>
<body>
<main>
<h1>${title}</h1>
<p>MetaCode 앱으로 돌아가세요. 이 탭은 닫아도 됩니다.</p>
</main>
</body>
</html>`;
}
