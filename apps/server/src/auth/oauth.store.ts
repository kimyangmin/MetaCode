import { Inject, Injectable } from '@nestjs/common';
import type { AuthClient } from '@metacode/shared';
import type { Redis } from 'ioredis';
import { REDIS } from '../redis/redis.module.js';
import { randomToken } from './crypto.js';

export type PendingLogin =
  | { client: typeof AuthClient.Web }
  | { client: typeof AuthClient.Desktop; codeChallenge: string; redirectPort: number };

interface DesktopCode {
  userId: string;
  codeChallenge: string;
}

const STATE_TTL_SECONDS = 10 * 60;
// 루프백으로 바로 앱에 전달되고 앱이 즉시 교환하므로 짧게 둔다.
const DESKTOP_CODE_TTL_SECONDS = 60;

/** OAuth 진행 중에만 필요한 일회용 값. 꺼내는 순간 지워진다(GETDEL). */
@Injectable()
export class OAuthStore {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async createState(login: PendingLogin): Promise<string> {
    const state = randomToken();
    await this.redis.set(`oauth:state:${state}`, JSON.stringify(login), 'EX', STATE_TTL_SECONDS);
    return state;
  }

  async consumeState(state: string): Promise<PendingLogin | null> {
    const value = await this.redis.getdel(`oauth:state:${state}`);
    return value ? (JSON.parse(value) as PendingLogin) : null;
  }

  /** 데스크톱 앱이 루프백으로 받아 토큰과 바꾸는 코드 */
  async createDesktopCode(entry: DesktopCode): Promise<string> {
    const code = randomToken();
    await this.redis.set(
      `oauth:desktop:${code}`,
      JSON.stringify(entry),
      'EX',
      DESKTOP_CODE_TTL_SECONDS,
    );
    return code;
  }

  async consumeDesktopCode(code: string): Promise<DesktopCode | null> {
    const value = await this.redis.getdel(`oauth:desktop:${code}`);
    return value ? (JSON.parse(value) as DesktopCode) : null;
  }
}
