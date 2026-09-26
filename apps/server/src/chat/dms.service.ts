import { BadRequestException, Injectable } from '@nestjs/common';
import { type DmSummary, SocketEvent } from '@metacode/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealtimeService, room } from '../realtime/realtime.service.js';
import { toProfile } from '../users/users.service.js';
import { ChannelSummaryService } from './channel-summary.service.js';

const dmInclude = { members: { include: { user: true }, orderBy: { joinedAt: 'asc' } } } as const;

@Injectable()
export class DmsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly summaries: ChannelSummaryService,
    private readonly realtime: RealtimeService,
  ) {}

  /** 최근 대화가 위로 오도록 정렬한 내 DM 목록 */
  async list(userId: string): Promise<DmSummary[]> {
    const channels = await this.prisma.channel.findMany({
      where: { communityId: null, members: { some: { userId } } },
      include: dmInclude,
      orderBy: { createdAt: 'desc' },
    });
    const dms = await this.withSummaries(userId, channels);
    const recency = (dm: DmSummary) => dm.lastMessageId ?? '';
    return dms.sort((a, b) => (recency(a) < recency(b) ? 1 : recency(a) > recency(b) ? -1 : 0));
  }

  /**
   * 상대가 1명이면 1:1 DM(이미 있으면 그것을 돌려준다), 2명 이상이면 새 그룹 DM을 만든다.
   * @returns created: 새로 만들었는지
   */
  async open(userId: string, otherIds: string[]): Promise<{ dm: DmSummary; created: boolean }> {
    const others = otherIds.filter((id) => id !== userId);
    if (others.length === 0) throw new BadRequestException('대화 상대를 골라 주세요.');
    const found = await this.prisma.user.count({ where: { id: { in: others } } });
    if (found !== others.length) throw new BadRequestException('없는 사용자가 있습니다.');

    const participants = [userId, ...others];
    const dmKey = others.length === 1 ? [...participants].sort().join(':') : null;
    if (dmKey) {
      const existing = await this.prisma.channel.findUnique({
        where: { dmKey },
        include: dmInclude,
      });
      if (existing)
        return { dm: (await this.withSummaries(userId, [existing]))[0]!, created: false };
    }

    const channel = await this.prisma.channel.create({
      data: {
        type: dmKey ? 'DM' : 'GROUP_DM',
        dmKey,
        members: { create: participants.map((id) => ({ userId: id })) },
      },
      include: dmInclude,
    });
    for (const id of participants) {
      this.realtime.joinUser(id, [room.channel(channel.id)]);
    }
    // 목록은 사용자마다 읽음 상태가 다르지만 새 채널이라 모두 같다.
    const [dm] = await this.withSummaries(userId, [channel]);
    this.realtime.emit(participants.map(room.user), SocketEvent.DmCreated, dm!);
    return { dm: dm!, created: true };
  }

  private async withSummaries(
    userId: string,
    channels: Array<{
      id: string;
      type: DmSummary['type'];
      communityId: string | null;
      name: string | null;
      members: Array<{ user: Parameters<typeof toProfile>[0] }>;
    }>,
  ): Promise<DmSummary[]> {
    const summaries = await this.summaries.summarize(userId, channels);
    return summaries.map((summary, i) => ({
      ...summary,
      participants: channels[i]!.members.map((m) => toProfile(m.user)),
    }));
  }
}
