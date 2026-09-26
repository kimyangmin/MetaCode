import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../redis/redis.module.js';

const key = (userId: string) => `presence:user:${userId}`;

/**
 * 온라인 상태 = 사용자에게 열린 WebSocket 연결이 하나 이상 있는 것.
 * 탭이나 기기를 여러 개 열 수 있으므로 연결(socket id)을 집합으로 센다.
 */
@Injectable()
export class PresenceService implements OnModuleInit {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /**
   * 서버가 비정상 종료되면 끊긴 연결이 Redis에 남는다. 지금은 서버가 하나뿐이므로
   * 시작할 때 전부 지운다. 서버를 여러 대로 늘리면 인스턴스별 키 + 만료 시간으로 바꿔야 한다.
   */
  async onModuleInit() {
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', key('*'), 'COUNT', 500);
      if (keys.length > 0) await this.redis.del(...keys);
      cursor = next;
    } while (cursor !== '0');
  }

  /** @returns 이 연결로 오프라인 → 온라인이 되었으면 true */
  async connect(userId: string, socketId: string): Promise<boolean> {
    const [[, added], [, count]] = (await this.redis
      .multi()
      .sadd(key(userId), socketId)
      .scard(key(userId))
      .exec()) as [[null, number], [null, number]];
    return added === 1 && count === 1;
  }

  /** @returns 이 연결이 끊겨 온라인 → 오프라인이 되었으면 true */
  async disconnect(userId: string, socketId: string): Promise<boolean> {
    const [[, removed], [, count]] = (await this.redis
      .multi()
      .srem(key(userId), socketId)
      .scard(key(userId))
      .exec()) as [[null, number], [null, number]];
    return removed === 1 && count === 0;
  }

  async getOnline(userIds: string[]): Promise<Record<string, boolean>> {
    const pipeline = this.redis.pipeline();
    for (const id of userIds) pipeline.exists(key(id));
    const results = (await pipeline.exec()) ?? [];
    return Object.fromEntries(userIds.map((id, i) => [id, results[i]?.[1] === 1]));
  }
}
