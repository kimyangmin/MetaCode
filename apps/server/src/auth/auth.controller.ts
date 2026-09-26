import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuthClient,
  type AuthTokens,
  type DesktopTokenRequest,
  type GithubLoginQuery,
  type RefreshTokenBody,
  desktopLoopbackUrl,
  desktopTokenRequestSchema,
  githubLoginQuerySchema,
  refreshTokenBodySchema,
} from '@metacode/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { Env } from '../config/env.js';
import { UsersService } from '../users/users.service.js';
import { OAUTH_STATE_COOKIE, REFRESH_COOKIE, ACCESS_COOKIE, authCookieOptions } from './cookies.js';
import { verifyPkce } from './crypto.js';
import { GithubAuthError, GithubClient } from './github.client.js';
import { OAuthStore, type PendingLogin } from './oauth.store.js';
import { SessionService } from './session.service.js';

const callbackQuerySchema = z.object({
  code: z.string().max(512).optional(),
  state: z.string().max(128).optional(),
  error: z.string().max(100).optional(),
});

type CallbackQuery = z.infer<typeof callbackQuerySchema>;

/** 로그인 실패 사유. 웹은 ?login_error=, 데스크톱은 루프백 주소의 ?error=로 전달한다. */
type LoginError = 'invalid_state' | 'access_denied' | 'github_error';

@Controller('auth')
export class AuthController {
  private readonly webOrigin: string;
  private readonly cookies: ReturnType<typeof authCookieOptions>;

  constructor(
    config: ConfigService<Env, true>,
    private readonly github: GithubClient,
    private readonly store: OAuthStore,
    private readonly sessions: SessionService,
    private readonly users: UsersService,
  ) {
    this.webOrigin = config.get('WEB_ORIGIN');
    this.cookies = authCookieOptions(this.webOrigin.startsWith('https://'));
  }

  /** 로그인 시작: GitHub 인증 화면으로 보낸다. */
  @Get('github')
  async startGithubLogin(
    @Query(new ZodValidationPipe(githubLoginQuerySchema)) query: GithubLoginQuery,
    @Res() res: Response,
  ): Promise<void> {
    if (!this.github.enabled) {
      throw new ServiceUnavailableException(
        'GitHub 로그인이 설정되지 않았습니다 (GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET).',
      );
    }
    const state = await this.store.createState(
      query.client === AuthClient.Desktop
        ? {
            client: AuthClient.Desktop,
            codeChallenge: query.code_challenge,
            redirectPort: query.redirect_port,
          }
        : { client: AuthClient.Web },
    );
    if (query.client === AuthClient.Web) {
      // state를 이 브라우저에 묶어 둔다. 다른 사람이 만든 콜백 링크로 로그인되는 것(login CSRF)을 막는다.
      res.cookie(OAUTH_STATE_COOKIE, state, this.cookies.oauthState);
    }
    res.redirect(this.github.authorizeUrl(state));
  }

  /** GitHub가 돌려보내는 곳. 웹은 쿠키를 심고, 데스크톱은 일회용 코드를 앱의 루프백 주소로 넘긴다. */
  @Get('github/callback')
  async githubCallback(
    @Query(new ZodValidationPipe(callbackQuerySchema)) query: CallbackQuery,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const pending = query.state ? await this.store.consumeState(query.state) : null;
    if (!pending) {
      res.status(400).type('text/plain').send('로그인 요청이 만료되었거나 올바르지 않습니다.');
      return;
    }
    if (pending.client === AuthClient.Web) {
      res.clearCookie(OAUTH_STATE_COOKIE, { path: this.cookies.oauthState.path });
      if (req.cookies?.[OAUTH_STATE_COOKIE] !== query.state) {
        return this.failLogin(res, pending, 'invalid_state');
      }
    }
    if (query.error || !query.code) {
      return this.failLogin(
        res,
        pending,
        query.error === 'access_denied' ? 'access_denied' : 'github_error',
      );
    }

    let profile;
    try {
      profile = await this.github.fetchProfile(query.code);
    } catch (error) {
      if (error instanceof GithubAuthError) return this.failLogin(res, pending, 'github_error');
      throw error;
    }
    const user = await this.users.upsertFromGithub(profile);

    if (pending.client === AuthClient.Web) {
      this.setAuthCookies(res, await this.sessions.issue(user.id, AuthClient.Web));
      res.redirect(this.webOrigin);
      return;
    }
    const code = await this.store.createDesktopCode({
      userId: user.id,
      codeChallenge: pending.codeChallenge,
    });
    res.redirect(desktopLoopbackUrl(pending.redirectPort, { code }));
  }

  /** 데스크톱: 루프백으로 받은 코드 + PKCE verifier를 토큰으로 바꾼다. */
  @Post('desktop/token')
  @HttpCode(200)
  async desktopToken(
    @Body(new ZodValidationPipe(desktopTokenRequestSchema)) body: DesktopTokenRequest,
  ): Promise<AuthTokens> {
    const entry = await this.store.consumeDesktopCode(body.code);
    if (!entry || !verifyPkce(body.codeVerifier, entry.codeChallenge)) {
      throw new UnauthorizedException('로그인 코드가 올바르지 않거나 만료되었습니다.');
    }
    return this.sessions.issue(entry.userId, AuthClient.Desktop);
  }

  /** 웹은 쿠키로, 데스크톱은 본문으로 리프레시 토큰을 보낸다. 응답도 같은 방식으로 돌려준다. */
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body(new ZodValidationPipe(refreshTokenBodySchema)) body: RefreshTokenBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokens | undefined> {
    const token = body.refreshToken ?? readRefreshCookie(req);
    if (!token) throw new UnauthorizedException('로그인이 필요합니다.');

    const tokens = await this.sessions.rotate(token);
    if (body.refreshToken) return tokens;
    this.setAuthCookies(res, tokens);
    return undefined;
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Body(new ZodValidationPipe(refreshTokenBodySchema)) body: RefreshTokenBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const token = body.refreshToken ?? readRefreshCookie(req);
    if (token) await this.sessions.revoke(token);
    res.clearCookie(ACCESS_COOKIE, { path: this.cookies.access.path });
    res.clearCookie(REFRESH_COOKIE, { path: this.cookies.refresh.path });
  }

  private setAuthCookies(res: Response, tokens: AuthTokens): void {
    res.cookie(ACCESS_COOKIE, tokens.accessToken, this.cookies.access);
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, this.cookies.refresh);
  }

  private failLogin(res: Response, pending: PendingLogin, reason: LoginError): void {
    if (pending.client === AuthClient.Web) {
      const url = new URL(this.webOrigin);
      url.searchParams.set('login_error', reason);
      res.redirect(url.href);
      return;
    }
    res.redirect(desktopLoopbackUrl(pending.redirectPort, { error: reason }));
  }
}

function readRefreshCookie(req: Request): string | undefined {
  const value: unknown = req.cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' ? value : undefined;
}
