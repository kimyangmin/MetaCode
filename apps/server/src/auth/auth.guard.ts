import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AccessTokenService } from './access-token.service.js';
import { ACCESS_COOKIE } from './cookies.js';

export interface AuthenticatedRequest extends Request {
  userId: string;
}

/** 데스크톱은 Authorization 헤더, 웹은 HttpOnly 쿠키로 액세스 토큰을 보낸다. */
export function extractAccessToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length);
  const cookie: unknown = req.cookies?.[ACCESS_COOKIE];
  return typeof cookie === 'string' ? cookie : undefined;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly accessTokens: AccessTokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractAccessToken(req);
    const userId = token ? this.accessTokens.verify(token) : null;
    if (!userId) throw new UnauthorizedException('로그인이 필요합니다.');
    req.userId = userId;
    return true;
  }
}
