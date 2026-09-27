import { HttpException, Logger } from '@nestjs/common';
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import {
  type ClientToServerEvents,
  type MessageDto,
  type PlazaSnapshot,
  type ServerToClientEvents,
  type SocketAck,
  SocketEvent,
  plazaMoveSchema,
  plazaWatchSchema,
  sendMessageSchema,
  typingStartSchema,
} from '@metacode/shared';
import type { Socket } from 'socket.io';
import { AccessTokenService } from '../auth/access-token.service.js';
import { ACCESS_COOKIE, readCookie } from '../auth/cookies.js';
import { PlazaService } from '../plaza/plaza.service.js';
import { PresenceService } from '../presence/presence.service.js';
import {
  type AppServer,
  RealtimeService,
  type SocketData,
  room,
} from '../realtime/realtime.service.js';
import { AccessService } from './access.service.js';
import { MessagesService } from './messages.service.js';

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, object, SocketData>;

/**
 * 모든 실시간 연결의 입구.
 * - 핸드셰이크에서 인증한다 (데스크톱은 auth.token, 웹은 HttpOnly 쿠키).
 * - 볼 수 있는 커뮤니티/채널 방에 넣는다. 이후 메시지는 방 단위로만 전달되므로 권한 없는 채널의 메시지는 받지 않는다.
 * - Presence를 기록하고 온라인/오프라인이 바뀌면 관련된 사람들에게 알린다.
 */
@WebSocketGateway()
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly accessTokens: AccessTokenService,
    private readonly access: AccessService,
    private readonly presence: PresenceService,
    private readonly messages: MessagesService,
    private readonly realtime: RealtimeService,
    private readonly plaza: PlazaService,
  ) {}

  afterInit(server: AppServer) {
    this.realtime.attach(server);
  }

  /**
   * 연결/해제 처리 중 오류(예: Redis 일시 장애)가 나도 서버가 죽지 않도록 여기서 잡는다.
   * Nest는 게이트웨이 생명주기 메서드의 거부된 Promise를 처리하지 않는다.
   */
  async handleConnection(socket: AppSocket) {
    try {
      await this.connect(socket);
    } catch (error) {
      this.logger.error('연결 처리 실패', error);
      socket.disconnect(true);
    }
  }

  async handleDisconnect(socket: AppSocket) {
    try {
      const { userId } = socket.data;
      if (userId && (await this.presence.disconnect(userId, socket.id))) {
        await this.broadcastPresence(userId, false);
      }
    } catch (error) {
      this.logger.error('연결 해제 처리 실패', error);
    }
  }

  private async connect(socket: AppSocket) {
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
    await socket.join(await this.access.roomsForUser(userId));
    if (await this.presence.connect(userId, socket.id)) {
      await this.broadcastPresence(userId, true);
    }
  }

  @SubscribeMessage(SocketEvent.MessageSend)
  async onMessageSend(socket: AppSocket, payload: unknown): Promise<SocketAck<MessageDto>> {
    const parsed = sendMessageSchema.safeParse(payload);
    if (!parsed.success) return { ok: false, error: '메시지 형식이 올바르지 않습니다.' };
    try {
      const message = await this.messages.send(
        socket.data.userId!,
        parsed.data.channelId,
        parsed.data.content,
        parsed.data.attachmentIds,
      );
      return { ok: true, data: message };
    } catch (error) {
      if (error instanceof HttpException) return { ok: false, error: error.message };
      this.logger.error(error);
      return { ok: false, error: '메시지를 보내지 못했습니다.' };
    }
  }

  @SubscribeMessage(SocketEvent.TypingStart)
  onTypingStart(socket: AppSocket, payload: unknown): void {
    const parsed = typingStartSchema.safeParse(payload);
    if (!parsed.success) return;
    const target = room.channel(parsed.data.channelId);
    // 들어가 있는 방(=볼 수 있는 채널)에만 알린다. DB를 다시 조회하지 않아도 권한이 보장된다.
    if (!socket.rooms.has(target)) return;
    socket.to(target).emit(SocketEvent.TypingStarted, {
      channelId: parsed.data.channelId,
      userId: socket.data.userId!,
    });
  }

  /** 광장 화면을 열 때: 멤버인지 확인하고 광장 방에 넣은 뒤 현재 상태를 돌려준다. */
  @SubscribeMessage(SocketEvent.PlazaWatch)
  async onPlazaWatch(socket: AppSocket, payload: unknown): Promise<SocketAck<PlazaSnapshot>> {
    const parsed = plazaWatchSchema.safeParse(payload);
    if (!parsed.success) return { ok: false, error: '광장 ID 형식이 올바르지 않습니다.' };
    try {
      const snapshot = await this.plaza.snapshot(socket.data.userId!, parsed.data.plazaId);
      await socket.join(room.plaza(parsed.data.plazaId));
      return { ok: true, data: snapshot };
    } catch (error) {
      if (error instanceof HttpException) return { ok: false, error: error.message };
      this.logger.error(error);
      return { ok: false, error: '광장을 열지 못했습니다.' };
    }
  }

  @SubscribeMessage(SocketEvent.PlazaUnwatch)
  async onPlazaUnwatch(socket: AppSocket, payload: unknown): Promise<void> {
    const parsed = plazaWatchSchema.safeParse(payload);
    if (parsed.success) await socket.leave(room.plaza(parsed.data.plazaId));
  }

  /**
   * 내 캐릭터 이동. 광장을 열어 둔(=멤버 확인을 거친) 연결만 보낼 수 있다.
   * 받아들이면 같은 광장을 보는 다른 사람들에게, 아니면 보낸 연결에만 되돌릴 위치를 보낸다.
   */
  @SubscribeMessage(SocketEvent.PlazaMove)
  async onPlazaMove(socket: AppSocket, payload: unknown): Promise<void> {
    const parsed = plazaMoveSchema.safeParse(payload);
    if (!parsed.success) return;
    const target = room.plaza(parsed.data.plazaId);
    if (!socket.rooms.has(target)) return;
    try {
      const result = await this.plaza.move(socket.data.userId!, parsed.data);
      if (result.ok) socket.to(target).emit(SocketEvent.PlazaMoved, result.moved);
      else socket.emit(SocketEvent.PlazaCorrected, result.correction);
    } catch (error) {
      this.logger.error('광장 이동 처리 실패', error);
    }
  }

  private async broadcastPresence(userId: string, online: boolean) {
    const audience = await this.access.presenceAudience(userId);
    if (audience.length > 0) {
      this.realtime.emit(audience, SocketEvent.PresenceChanged, { userId, online });
    }
    // 광장 인원 = 멤버 중 온라인. 이 사람이 속한 광장들을 보고 있는 사람들에게 나타남/사라짐을 알린다.
    for (const plazaId of await this.plaza.plazaIdsOf(userId)) {
      this.realtime.emit(room.plaza(plazaId), SocketEvent.PlazaMember, {
        plazaId,
        userId,
        occupant: online ? await this.plaza.occupant(plazaId, userId) : null,
      });
    }
  }
}
