import { z } from 'zod';

export const AuthClient = {
  Web: 'web',
  Desktop: 'desktop',
  Android: 'android',
} as const;

export type AuthClient = (typeof AuthClient)[keyof typeof AuthClient];

/**
 * 데스크톱 로그인은 루프백 리디렉션(RFC 8252)을 쓴다. 앱이 로그인하는 동안
 * http://127.0.0.1:<port>/callback 에서 결과를 받고, 서버는 이 주소로만 돌려보낸다.
 */
export const DESKTOP_LOOPBACK_HOST = '127.0.0.1';
export const DESKTOP_LOOPBACK_PATH = '/callback';

/** PKCE code_verifier 형식 (RFC 7636): 43~128자, [A-Za-z0-9-._~] */
const pkceString = z
  .string()
  .min(43)
  .max(128)
  .regex(/^[A-Za-z0-9\-._~]+$/);

export const githubLoginQuerySchema = z.discriminatedUnion('client', [
  z.object({ client: z.literal(AuthClient.Web) }),
  z.object({
    client: z.literal(AuthClient.Desktop),
    code_challenge: pkceString,
    /** 앱이 열어 둔 루프백 포트 */
    redirect_port: z.coerce.number().int().min(1024).max(65535),
  }),
  z.object({ client: z.literal(AuthClient.Android), code_challenge: pkceString }),
]);

/**
 * 안드로이드 로그인: 앱이 Custom Tab(시스템 브라우저)으로 GitHub 로그인을 열고, 서버는 끝나면
 * 이 주소(앱이 등록한 metacode:// 스킴)로 일회용 코드를 돌려보낸다. 코드는 PKCE verifier가 있어야
 * 쓸 수 있으므로, 다른 앱이 이 스킴을 가로채도 로그인할 수 없다.
 */
export const ANDROID_AUTH_REDIRECT = 'metacode://auth';

export function androidAuthRedirectUrl(params: Record<string, string>): string {
  return `${ANDROID_AUTH_REDIRECT}?${new URLSearchParams(params).toString()}`;
}

export function desktopLoopbackUrl(port: number, params: Record<string, string>): string {
  const url = new URL(`http://${DESKTOP_LOOPBACK_HOST}:${port}${DESKTOP_LOOPBACK_PATH}`);
  url.search = new URLSearchParams(params).toString();
  return url.href;
}

export type GithubLoginQuery = z.infer<typeof githubLoginQuerySchema>;

export const desktopTokenRequestSchema = z.object({
  code: z.string().min(1).max(256),
  codeVerifier: pkceString,
});

export type DesktopTokenRequest = z.infer<typeof desktopTokenRequestSchema>;

/** 안드로이드: 딥링크로 받은 코드 + PKCE verifier를 로그인 쿠키로 바꾼다 (앱 안의 화면은 웹이라 쿠키를 쓴다) */
export const androidSessionRequestSchema = desktopTokenRequestSchema;
export type AndroidSessionRequest = DesktopTokenRequest;

/** 웹은 쿠키로 보내므로 본문이 비어 있고, 데스크톱은 본문에 담아 보낸다. */
export const refreshTokenBodySchema = z
  .object({ refreshToken: z.string().min(1).max(256).optional() })
  .default({});

export type RefreshTokenBody = z.infer<typeof refreshTokenBodySchema>;

/** 데스크톱 앱이 받는 토큰. 웹은 같은 값을 HttpOnly 쿠키로 받는다. */
export interface AuthTokens {
  accessToken: string;
  /** 초 단위 */
  accessTokenExpiresIn: number;
  refreshToken: string;
}
