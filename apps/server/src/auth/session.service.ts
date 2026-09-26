import { randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { AuthClient, AuthTokens } from '@metacode/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ACCESS_TOKEN_TTL_SECONDS, AccessTokenService } from './access-token.service.js';
import { randomToken, sha256Base64Url } from './crypto.js';

/** 리프레시 토큰 유효 시간 (초) */
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * 교체된 직후의 토큰이 다시 오는 것은 탈취가 아니라 동시 요청일 수 있다
 * (웹에서 탭 두 개가 동시에 갱신하는 경우). 이 시간 안의 재사용은 family를 폐기하지 않는다.
 */
const REUSE_GRACE_MS = 30 * 1000;

type Db = PrismaService | Prisma.TransactionClient;

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessTokens: AccessTokenService,
  ) {}

  /** 로그인 직후 새 세션(새 family)을 연다. */
  issue(userId: string, client: AuthClient): Promise<AuthTokens> {
    return this.createTokens(this.prisma, userId, client, randomUUID());
  }

  /** 리프레시 토큰을 새 토큰으로 교체한다. 쓰인 토큰은 즉시 폐기된다. */
  async rotate(refreshToken: string): Promise<AuthTokens> {
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256Base64Url(refreshToken) },
    });
    if (!existing) throw new UnauthorizedException('유효하지 않은 세션입니다.');

    if (existing.revokedAt) {
      if (Date.now() - existing.revokedAt.getTime() > REUSE_GRACE_MS) {
        // 오래전에 교체된 토큰이 다시 쓰였다: 탈취로 보고 이 로그인 세션 전체를 끊는다.
        await this.revokeFamily(existing.familyId);
      }
      throw new UnauthorizedException('유효하지 않은 세션입니다.');
    }
    if (existing.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('세션이 만료되었습니다.');
    }

    return this.prisma.$transaction(async (tx) => {
      // 조건부 갱신으로 동시에 들어온 같은 토큰 중 하나만 통과시킨다.
      const { count } = await tx.refreshToken.updateMany({
        where: { id: existing.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (count === 0) throw new UnauthorizedException('유효하지 않은 세션입니다.');
      return this.createTokens(
        tx,
        existing.userId,
        existing.client as AuthClient,
        existing.familyId,
      );
    });
  }

  /** 로그아웃: 이 토큰이 속한 로그인 세션을 끊는다. 없는 토큰이면 조용히 무시한다. */
  async revoke(refreshToken: string): Promise<void> {
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256Base64Url(refreshToken) },
      select: { familyId: true },
    });
    if (existing) await this.revokeFamily(existing.familyId);
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async createTokens(
    db: Db,
    userId: string,
    client: AuthClient,
    familyId: string,
  ): Promise<AuthTokens> {
    const refreshToken = randomToken();
    await db.refreshToken.create({
      data: {
        userId,
        client,
        familyId,
        tokenHash: sha256Base64Url(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
      },
    });
    return {
      accessToken: this.accessTokens.sign(userId),
      accessTokenExpiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken,
    };
  }
}
