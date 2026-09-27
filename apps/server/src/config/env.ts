import { z } from 'zod';

const url = z.url();
/** .env에 빈 값으로 적어 둔 주소는 없는 것으로 본다 */
const optionalUrl = z.preprocess((v) => (v === '' ? undefined : v), url.optional());

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

  /** 서버가 파일 저장소에 접속하는 주소 (운영: 내부 주소 http://seaweedfs:9000) */
  S3_ENDPOINT: url.default('http://localhost:9000'),
  /** 브라우저가 파일을 올리고 받는 주소. presigned URL을 이 주소로 서명한다 (운영: https://<FILES_DOMAIN>) */
  S3_PUBLIC_ENDPOINT: url.optional(),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_BUCKET: z.string().min(1).default('metacode-uploads'),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  UPLOAD_MAX_SIZE_MB: z.coerce.number().int().positive().default(50),

  /** 서버가 LiveKit API에 접속하는 주소 (운영: 내부 주소 http://livekit:7880). 비우면 음성 통화를 쓸 수 없다 */
  LIVEKIT_URL: optionalUrl,
  /** 브라우저가 LiveKit에 접속하는 주소 (운영: wss://<LIVEKIT_DOMAIN>). 비우면 LIVEKIT_URL을 쓴다 */
  LIVEKIT_PUBLIC_URL: optionalUrl,
  LIVEKIT_API_KEY: z.string().default(''),
  LIVEKIT_API_SECRET: z.string().default(''),
  /** 실시간 연결이 끊긴 참여자를 통화에서 빼기 전에 기다리는 시간 (잠깐 끊겼다 다시 붙는 경우) */
  VOICE_DISCONNECT_GRACE_MS: z.coerce.number().int().nonnegative().default(15_000),

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
