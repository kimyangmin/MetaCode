// 로컬 개발용 가짜 GitHub OAuth. 실제 GitHub 없이 여러 사용자로 로그인해 볼 때 쓴다.
//   node tools/fake-github.mjs
// 서버는 GitHub 주소를 이 서버로 바꿔서 띄운다 (docs 참고: README "여러 사용자로 확인하기").
// 인증 화면에서 로그인할 사용자를 고른다. 사용자를 늘리려면 USERS에 추가한다.
import { createServer } from 'node:http';

const PORT = Number(process.env.FAKE_GITHUB_PORT ?? 4010);
const USERS = {
  alice: {
    id: 910001,
    login: 'dev-alice',
    name: '앨리스',
    avatar_url: 'https://avatars.githubusercontent.com/u/583231',
  },
  bob: {
    id: 910002,
    login: 'dev-bob',
    name: '밥',
    avatar_url: 'https://avatars.githubusercontent.com/u/9919',
  },
  carol: {
    id: 910003,
    login: 'dev-carol',
    name: '캐롤',
    avatar_url: 'https://avatars.githubusercontent.com/u/1',
  },
};

const codes = new Map();
const tokens = new Map();
const escape = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (url.pathname === '/login/oauth/authorize') {
    const links = Object.entries(USERS).map(([key, user]) => {
      const code = `${key}-${Math.random().toString(36).slice(2)}`;
      codes.set(code, user);
      const back = new URL(url.searchParams.get('redirect_uri') ?? '');
      back.searchParams.set('code', code);
      back.searchParams.set('state', url.searchParams.get('state') ?? '');
      return `<li><a id="as-${key}" href="${escape(back.href)}">${escape(user.name)} (${user.login})로 승인</a></li>`;
    });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8"><h1>Fake GitHub</h1><ul>${links.join('')}</ul>`);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/login/oauth/access_token') {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const { code } = JSON.parse(raw);
      const user = codes.get(code);
      codes.delete(code);
      const token = `gho_fake_${Math.random().toString(36).slice(2)}`;
      if (user) tokens.set(token, user);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(user ? { access_token: token } : { error: 'bad_verification_code' }));
    });
    return;
  }

  if (url.pathname === '/user') {
    const user = tokens.get((req.headers.authorization ?? '').replace('Bearer ', ''));
    res.writeHead(user ? 200 : 401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(user ?? { message: 'Bad credentials' }));
    return;
  }

  res.writeHead(404).end();
}).listen(PORT, () => console.log(`fake GitHub: http://localhost:${PORT}`));
