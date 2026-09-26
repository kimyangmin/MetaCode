import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeGithubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
}

/**
 * GitHub OAuth의 코드 교환(/login/oauth/access_token)과 프로필 조회(/user)만 흉내 낸다.
 * addCode로 "이 코드로 로그인하면 이 사용자"를 미리 등록해 둔다.
 */
export async function startFakeGithub(clientId: string, clientSecret: string) {
  const codes = new Map<string, FakeGithubUser>();
  const tokens = new Map<string, FakeGithubUser>();

  const server = createServer((req, res) => {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.method === 'POST' && req.url === '/login/oauth/access_token') {
      let raw = '';
      req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
      req.on('end', () => {
        const body = JSON.parse(raw) as { client_id: string; client_secret: string; code: string };
        const user = codes.get(body.code);
        if (body.client_id !== clientId || body.client_secret !== clientSecret || !user) {
          // 실제 GitHub처럼 200에 error를 담아 돌려준다.
          return json(200, { error: 'bad_verification_code' });
        }
        codes.delete(body.code);
        const token = `gho_${Math.random().toString(36).slice(2)}`;
        tokens.set(token, user);
        json(200, { access_token: token, token_type: 'bearer', scope: 'read:user' });
      });
      return;
    }

    if (req.method === 'GET' && req.url === '/user') {
      const user = tokens.get(req.headers.authorization?.replace('Bearer ', '') ?? '');
      return user ? json(200, user) : json(401, { message: 'Bad credentials' });
    }

    json(404, { message: 'Not Found' });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    addCode(code: string, user: FakeGithubUser) {
      codes.set(code, user);
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
