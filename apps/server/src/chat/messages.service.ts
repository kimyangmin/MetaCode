import { BadRequestException, Injectable } from '@nestjs/common';
import { type MessageDto, type MessagePage, SocketEvent } from '@metacode/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealtimeService, room } from '../realtime/realtime.service.js';
import { toProfile } from '../users/users.service.js';
import { AccessService } from './access.service.js';

type MessageRow = {
  id: string;
  channelId: string;
  content: string;
  createdAt: Date;
  author: Parameters<typeof toProfile>[0];
};

export function toMessageDto(message: MessageRow): MessageDto {
  return {
    id: message.id,
    channelId: message.channelId,
    author: toProfile(message.author),
    content: message.content,
    createdAt: message.createdAt.toISOString(),
  };
}

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * 메시지를 저장하고 채널 방 전체에 message:created로 보낸다.
   * 채팅 모드와 메타버스 모드(말풍선)가 모두 이 이벤트 하나를 받는다.
   */
  async send(userId: string, channelId: string, content: string): Promise<MessageDto> {
    const channel = await this.access.getChannel(userId, channelId);
    if (channel.type === 'VOICE')
      throw new BadRequestException('음성 채널에는 글을 쓸 수 없습니다.');

    const message = toMessageDto(
      await this.prisma.message.create({
        data: { channelId, authorId: userId, content },
        include: { author: true },
      }),
    );
    this.realtime.emit(room.channel(channelId), SocketEvent.MessageCreated, message);
    return message;
  }

  /** 최신 메시지부터 limit개. before를 주면 그보다 오래된 것 */
  async history(
    userId: string,
    channelId: string,
    before: string | undefined,
    limit: number,
  ): Promise<MessagePage> {
    await this.access.getChannel(userId, channelId);
    const rows = await this.prisma.message.findMany({
      where: { channelId, ...(before ? { id: { lt: before } } : {}) },
      orderBy: { id: 'desc' },
      take: limit + 1,
      include: { author: true },
    });
    return {
      messages: rows.slice(0, limit).map(toMessageDto),
      hasMore: rows.length > limit,
    };
  }

  /** 읽음 위치를 앞으로만 옮긴다 (다른 탭에서 늦게 온 요청이 되돌리지 않도록). */
  async markRead(userId: string, channelId: string, lastReadMessageId: string): Promise<void> {
    await this.access.getChannel(userId, channelId);
    const message = await this.prisma.message.findFirst({
      where: { id: lastReadMessageId, channelId },
      select: { id: true },
    });
    if (!message) throw new BadRequestException('이 채널의 메시지가 아닙니다.');

    const current = await this.prisma.channelReadState.findUnique({
      where: { channelId_userId: { channelId, userId } },
      select: { lastReadMessageId: true },
    });
    if (current && current.lastReadMessageId >= lastReadMessageId) return;
    await this.prisma.channelReadState.upsert({
      where: { channelId_userId: { channelId, userId } },
      create: { channelId, userId, lastReadMessageId },
      update: { lastReadMessageId },
    });
  }
}
