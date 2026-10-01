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
  type VoiceCall,
  type VoiceJoinResult,
  deleteMessageSchema,
  editMessageSchema,
  forwardMessageSchema,
  plazaMoveSchema,
  plazaSetMotionSchema,
  plazaWatchSchema,
  sendMessageSchema,
  typingStartSchema,
  voiceJoinSchema,
  voiceSetProximitySchema,
  voiceUpdateSchema,
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
import { VoiceService } from '../voice/voice.service.js';
import { AccessService } from './access.service.js';
import { MessagesService } from './messages.service.js';

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, object, SocketData>;

/** 광장 모션 요청 사이의 최소 간격 (연타 방지) */
const MOTION_MIN_INTERVAL_MS = 150;

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
    private readonly voice: VoiceService,
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
      if (userId) this.voice.disconnected(userId, socket.id);
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
        parsed.data.replyToId,
      );
      return { ok: true, data: message };
    } catch (error) {
      if (error instanceof HttpException) return { ok: false, error: error.message };
      this.logger.error(error);
      return { ok: false, error: '메시지를 보내지 못했습니다.' };
    }
  }

  /** 메시지 전달 (다른 채널이나 DM으로) */
  @SubscribeMessage(SocketEvent.MessageForward)
  async onMessageForward(socket: AppSocket, payload: unknown): Promise<SocketAck<MessageDto>> {
    const parsed = forwardMessageSchema.safeParse(payload);
    if (!parsed.success) return { ok: false, error: '요청 형식이 올바르지 않습니다.' };
    try {
      const message = await this.messages.forward(
        socket.data.userId!,
        parsed.data.messageId,
        parsed.data.channelId,
      );
      return { ok: true, data: message };
    } catch (error) {
      return this.fail(error, '메시지를 전달하지 못했습니다.');
    }
  }

  /** 내가 보낸 메시지 고치기 */
  @SubscribeMessage(SocketEvent.MessageEdit)
  async onMessageEdit(socket: AppSocket, payload: unknown): Promise<SocketAck<MessageDto>> {
    const parsed = editMessageSchema.safeParse(payload);
    if (!parsed.success) return { ok: false, error: '요청 형식이 올바르지 않습니다.' };
    try {
      const message = await this.messages.edit(
        socket.data.userId!,
        parsed.data.messageId,
        parsed.data.content,
      );
      return { ok: true, data: message };
    } catch (error) {
      return this.fail(error, '메시지를 고치지 못했습니다.');
    }
  }

  /** 내가 보낸 메시지 지우기 */
  @SubscribeMessage(SocketEvent.MessageDelete)
  async onMessageDelete(socket: AppSocket, payload: unknown): Promise<SocketAck<null>> {
    const parsed = deleteMessageSchema.safeParse(payload);
    if (!parsed.success) return { ok: false, error: '요청 형식이 올바르지 않습니다.' };
    try {
      await this.messages.remove(socket.data.userId!, parsed.data.messageId);
      return { ok: true, data: null };
    } catch (error) {
      return this.fail(error, '메시지를 지우지 못했습니다.');
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
      if (!result.ok) return void socket.emit(SocketEvent.PlazaCorrected, result.correction);
      socket.to(target).emit(SocketEvent.PlazaMoved, result.moved);
      await this.voice.moved(parsed.data.plazaId, socket.data.userId!);
    } catch (error) {
      this.logger.error('광장 이동 처리 실패', error);
    }
  }

  /**
   * 내 캐릭터 모션(숫자 키). 광장을 열어 둔 연결만 보낼 수 있고, 같은 광장을 보는 다른 사람에게 알린다.
   * 키를 빠르게 연타해도 부담이 없게 너무 잦은 요청은 버린다.
   */
  @SubscribeMessage(SocketEvent.PlazaSetMotion)
  async onPlazaSetMotion(socket: AppSocket, payload: unknown): Promise<void> {
    const parsed = plazaSetMotionSchema.safeParse(payload);
    if (!parsed.success) return;
    const target = room.plaza(parsed.data.plazaId);
    if (!socket.rooms.has(target)) return;
    const now = Date.now();
    if (now - (socket.data.lastMotionAt ?? 0) < MOTION_MIN_INTERVAL_MS) return;
    socket.data.lastMotionAt = now;
    try {
      const changed = await this.plaza.setMotion(
        socket.data.userId!,
        parsed.data.plazaId,
        parsed.data.motion,
        parsed.data.loop,
      );
      socket.to(target).emit(SocketEvent.PlazaMotionChanged, changed);
    } catch (error) {
      this.logger.error('광장 모션 처리 실패', error);
    }
  }

  /** 볼 수 있는 진행 중인 통화 전부. 접속할 때와 커뮤니티 목록이 바뀔 때 부른다. */
  @SubscribeMessage(SocketEvent.VoiceSync)
  async onVoiceSync(socket: AppSocket): Promise<SocketAck<VoiceCall[]>> {
    try {
      return { ok: true, data: await this.voice.sync(socket.data.userId!) };
    } catch (error) {
      return this.fail(error, '통화 목록을 불러오지 못했습니다.');
    }
  }

  /** 통화에 들어간다: 권한을 확인하고 음성 서버 입장권을 준다. 다른 통화에 있었으면 거기서 나온다. */
  @SubscribeMessage(SocketEvent.VoiceJoin)
  async onVoiceJoin(socket: AppSocket, payload: unknown): Promise<SocketAck<VoiceJoinResult>> {
    const parsed = voiceJoinSchema.safeParse(payload);
    if (!parsed.success) return { ok: false, error: '채널 ID 형식이 올바르지 않습니다.' };
    try {
      const result = await this.voice.join(socket.data.userId!, socket.id, parsed.data.channelId);
      return { ok: true, data: result };
    } catch (error) {
      return this.fail(error, '통화에 들어가지 못했습니다.');
    }
  }

  @SubscribeMessage(SocketEvent.VoiceLeave)
  async onVoiceLeave(socket: AppSocket): Promise<void> {
    try {
      await this.voice.leave(socket.data.userId!, socket.id);
    } catch (error) {
      this.logger.error('통화 나가기 처리 실패', error);
    }
  }

  @SubscribeMessage(SocketEvent.VoiceUpdate)
  onVoiceUpdate(socket: AppSocket, payload: unknown): void {
    const parsed = voiceUpdateSchema.safeParse(payload);
    if (parsed.success) this.voice.update(socket.data.userId!, socket.id, parsed.data);
  }

  @SubscribeMessage(SocketEvent.VoiceSetProximity)
  async onVoiceSetProximity(socket: AppSocket, payload: unknown): Promise<SocketAck<null>> {
    const parsed = voiceSetProximitySchema.safeParse(payload);
    if (!parsed.success) return { ok: false, error: '요청 형식이 올바르지 않습니다.' };
    try {
      await this.voice.setProximity(
        socket.data.userId!,
        parsed.data.channelId,
        parsed.data.enabled,
      );
      return { ok: true, data: null };
    } catch (error) {
      return this.fail(error, '근접 음성을 바꾸지 못했습니다.');
    }
  }

  /** 예상한 거절(HttpException)은 그 메시지를, 나머지는 기록하고 일반 메시지를 돌려준다 */
  private fail(error: unknown, fallback: string): { ok: false; error: string } {
    if (error instanceof HttpException) return { ok: false, error: error.message };
    this.logger.error(error);
    return { ok: false, error: fallback };
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
