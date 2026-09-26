import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import type { GithubProfile } from '../users/users.service.js';

const tokenResponseSchema = z.object({ access_token: z.string().min(1) });

const userResponseSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1),
  name: z.string().nullable(),
  avatar_url: z.url(),
});

export class GithubAuthError extends Error {}

/** GitHub OAuth App 연동. 코드 교환과 프로필 조회만 하고, GitHub 토큰은 저장하지 않는다. */
@Injectable()
export class GithubClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly oauthUrl: string;
  private readonly apiUrl: string;
  private readonly redirectUri: string;

  constructor(config: ConfigService<Env, true>) {
    this.clientId = config.get('GITHUB_CLIENT_ID');
    this.clientSecret = config.get('GITHUB_CLIENT_SECRET');
    this.oauthUrl = config.get('GITHUB_OAUTH_URL');
    this.apiUrl = config.get('GITHUB_API_URL');
    this.redirectUri = new URL('/auth/github/callback', config.get('PUBLIC_SERVER_URL')).href;
  }

  get enabled(): boolean {
    return this.clientId !== '' && this.clientSecret !== '';
  }

  authorizeUrl(state: string): string {
    const url = new URL('/login/oauth/authorize', this.oauthUrl);
    url.search = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      // 공개 프로필(이름, 아바타)만 읽는다.
      scope: 'read:user',
      state,
      allow_signup: 'true',
    }).toString();
    return url.href;
  }

  async fetchProfile(code: string): Promise<GithubProfile> {
    const tokenRes = await fetch(new URL('/login/oauth/access_token', this.oauthUrl), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        redirect_uri: this.redirectUri,
      }),
    });
    // GitHub는 코드가 틀려도 200에 error 필드를 담아 돌려주므로 본문 형식으로 판단한다.
    const token = tokenResponseSchema.safeParse(await tokenRes.json().catch(() => null));
    if (!tokenRes.ok || !token.success) throw new GithubAuthError('GitHub 코드 교환 실패');

    const userRes = await fetch(new URL('/user', this.apiUrl), {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token.data.access_token}`,
        'User-Agent': 'MetaCode',
      },
    });
    const user = userResponseSchema.safeParse(await userRes.json().catch(() => null));
    if (!userRes.ok || !user.success) throw new GithubAuthError('GitHub 프로필 조회 실패');

    return {
      id: user.data.id,
      login: user.data.login,
      name: user.data.name,
      avatarUrl: user.data.avatar_url,
    };
  }
}
