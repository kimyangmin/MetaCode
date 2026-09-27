import { Injectable } from '@nestjs/common';
import type { ChannelSummary, ChannelType } from '@metacode/shared';
import { PrismaService } from '../prisma/prisma.service.js';

interface ChannelRow {
  id: string;
  type: ChannelType;
  communityId: string | null;
  name: string | null;
  private: boolean;
}

/**
 * 채널 목록에 "마지막 메시지"와 "내가 마지막으로 읽은 메시지"를 붙여 안 읽음 표시를 할 수 있게 한다.
 * 비공개 채널이면 볼 수 있는 역할도 붙인다 (채널 설정 화면).
 */
@Injectable()
export class ChannelSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async summarize(userId: string, channels: ChannelRow[]): Promise<ChannelSummary[]> {
    if (channels.length === 0) return [];
    const ids = channels.map((c) => c.id);

    // PostgreSQL에는 uuid용 max()가 없으므로 DISTINCT ON으로 채널마다 가장 큰(최신) id를 고른다.
    // (channel_id, id DESC) 인덱스를 그대로 탄다.
    const lastMessages = await this.prisma.$queryRaw<{ channel_id: string; id: string }[]>`
      SELECT DISTINCT ON (channel_id) channel_id, id
      FROM messages
      WHERE channel_id = ANY(${ids}::uuid[])
      ORDER BY channel_id, id DESC`;
    const readStates = await this.prisma.channelReadState.findMany({
      where: { userId, channelId: { in: ids } },
      select: { channelId: true, lastReadMessageId: true },
    });

    const access = await this.prisma.channelRoleAccess.findMany({
      where: { channelId: { in: channels.filter((c) => c.private).map((c) => c.id) } },
      select: { channelId: true, roleId: true },
    });

    const lastById = new Map(lastMessages.map((m) => [m.channel_id, m.id]));
    const readById = new Map(readStates.map((r) => [r.channelId, r.lastReadMessageId]));
    return channels.map((c) => ({
      id: c.id,
      type: c.type,
      communityId: c.communityId,
      name: c.name,
      lastMessageId: lastById.get(c.id) ?? null,
      lastReadMessageId: readById.get(c.id) ?? null,
      private: c.private,
      roleIds: access.filter((a) => a.channelId === c.id).map((a) => a.roleId),
    }));
  }
}
