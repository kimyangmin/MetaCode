import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/** 액세스 토큰 유효 시간 (초) */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

interface AccessTokenPayload {
  sub: string;
}

@Injectable()
export class AccessTokenService {
  constructor(private readonly jwt: JwtService) {}

  sign(userId: string): string {
    const payload: AccessTokenPayload = { sub: userId };
    return this.jwt.sign(payload, { expiresIn: ACCESS_TOKEN_TTL_SECONDS });
  }

  /** 유효하면 사용자 ID, 아니면(만료, 위조, 형식 오류) null */
  verify(token: string): string | null {
    try {
      const payload = this.jwt.verify<AccessTokenPayload>(token);
      return typeof payload.sub === 'string' ? payload.sub : null;
    } catch {
      return null;
    }
  }
}
