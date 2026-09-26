import { Logger } from '@nestjs/common';
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import { AccessTokenService } from '../auth/access-token.service.js';
import { ACCESS_COOKIE, readCookie } from '../auth/cookies.js';
import { PresenceService } from './presence.service.js';

interface SocketData {
  userId?: string;
}

/**
 * 모든 실시간 연결의 입구. 핸드셰이크에서 인증하고 Presence를 기록한다.
 * 데스크톱은 auth.token, 웹은 HttpOnly 쿠키로 액세스 토큰을 보낸다.
 */
@WebSocketGateway()
export class PresenceGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(PresenceGateway.name);

  constructor(
    private readonly accessTokens: AccessTokenService,
    private readonly presence: PresenceService,
  ) {}

  async handleConnection(socket: Socket<never, never, never, SocketData>) {
    const authToken: unknown = socket.handshake.auth?.token;
    const token =
      typeof authToken === 'string'
        ? authToken
        : readCookie(socket.handshake.headers.cookie, ACCESS_COOKIE);
    const userId = token ? this.accessTokens.verify(token) : null;
    if (!userId) {
      socket.disconnect(true);
      return;
    }

    socket.data.userId = userId;
    await socket.join(`user:${userId}`);
    if (await this.presence.connect(userId, socket.id)) {
      this.logger.debug(`online: ${userId}`);
    }
  }

  async handleDisconnect(socket: Socket<never, never, never, SocketData>) {
    const { userId } = socket.data;
    if (userId && (await this.presence.disconnect(userId, socket.id))) {
      this.logger.debug(`offline: ${userId}`);
    }
  }
}
