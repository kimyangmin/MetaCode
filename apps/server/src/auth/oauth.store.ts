import { Inject, Injectable } from '@nestjs/common';
import type { AuthClient } from '@metacode/shared';
import type { Redis } from 'ioredis';
import { REDIS } from '../redis/redis.module.js';
import { randomToken } from './crypto.js';

export type PendingLogin =
  | { client: typeof AuthClient.Web }
  | { client: typeof AuthClient.Desktop; codeChallenge: string; redirectPort: number }
  | { client: typeof AuthClient.Android; codeChallenge: string };

/** 코드를 받아 바꾸는 앱 */
export type AppClient = typeof AuthClient.Desktop | typeof AuthClient.Android;

/** 앱(데스크톱, 안드로이드)이 받아 토큰이나 쿠키와 바꾸는 일회용 코드 */
interface AppCode {
  userId: string;
  codeChallenge: string;
}

const STATE_TTL_SECONDS = 10 * 60;
// 루프백·딥링크로 바로 앱에 전달되고 앱이 즉시 교환하므로 짧게 둔다.
const APP_CODE_TTL_SECONDS = 60;

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

  /**
   * 앱이 받아 바꾸는 코드. 앱 종류마다 따로 두어, 데스크톱 코드를 안드로이드 쪽에서 쓰는 식으로 섞이지 않게 한다.
   * 데스크톱은 루프백으로, 안드로이드는 딥링크로 받는다.
   */
  async createAppCode(client: AppClient, entry: AppCode): Promise<string> {
    const code = randomToken();
    await this.redis.set(
      `oauth:${client}:${code}`,
      JSON.stringify(entry),
      'EX',
      APP_CODE_TTL_SECONDS,
    );
    return code;
  }

  async consumeAppCode(client: AppClient, code: string): Promise<AppCode | null> {
    const value = await this.redis.getdel(`oauth:${client}:${code}`);
    return value ? (JSON.parse(value) as AppCode) : null;
  }
}
