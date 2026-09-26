import { z } from 'zod';

const url = z.url();

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SERVER_PORT: z.coerce.number().int().positive().default(3000),
  /** 브라우저와 GitHub가 서버에 접속하는 주소. OAuth 콜백 URL을 만들 때 쓴다. */
  PUBLIC_SERVER_URL: url.default('http://localhost:3000'),
  WEB_ORIGIN: url.default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  /** 비어 있으면 서버는 뜨지만 GitHub 로그인이 503을 돌려준다. */
  GITHUB_CLIENT_ID: z.string().default(''),
  GITHUB_CLIENT_SECRET: z.string().default(''),
  GITHUB_OAUTH_URL: url.default('https://github.com'),
  GITHUB_API_URL: url.default('https://api.github.com'),

  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET은 32자 이상이어야 합니다. 예: openssl rand -base64 48'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`환경변수가 올바르지 않습니다 (.env 확인):\n${lines.join('\n')}`);
  }
  return result.data;
}
