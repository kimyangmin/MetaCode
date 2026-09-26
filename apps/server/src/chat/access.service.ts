import { Injectable, NotFoundException } from '@nestjs/common';
import type { ChannelType } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { room } from '../realtime/realtime.service.js';

export interface AccessibleChannel {
  id: string;
  type: ChannelType;
  communityId: string | null;
}

/**
 * 누가 무엇을 볼 수 있는지 한 곳에서 판단한다.
 * - 커뮤니티 채널: 그 커뮤니티의 멤버
 * - DM/그룹 DM: 참여자
 * 권한이 없으면 존재 여부도 알려주지 않도록 404로 응답한다.
 */
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  async getChannel(userId: string, channelId: string): Promise<AccessibleChannel> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, type: true, communityId: true },
    });
    if (!channel) throw new NotFoundException('채널을 찾을 수 없습니다.');

    const allowed = channel.communityId
      ? await this.prisma.communityMember.findUnique({
          where: { communityId_userId: { communityId: channel.communityId, userId } },
          select: { userId: true },
        })
      : await this.prisma.channelMember.findUnique({
          where: { channelId_userId: { channelId, userId } },
          select: { userId: true },
        });
    if (!allowed) throw new NotFoundException('채널을 찾을 수 없습니다.');
    return channel;
  }

  async getMembership(userId: string, communityId: string) {
    const membership = await this.prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId, userId } },
    });
    if (!membership) throw new NotFoundException('커뮤니티를 찾을 수 없습니다.');
    return membership;
  }

  /** 접속할 때 들어갈 방: 내 사용자 방, 내 커뮤니티들, 볼 수 있는 모든 채널 */
  async roomsForUser(userId: string): Promise<string[]> {
    const communityIds = await this.communityIdsOf(userId);
    const channels = await this.prisma.channel.findMany({
      where: {
        OR: [{ communityId: { in: communityIds } }, { members: { some: { userId } } }],
      },
      select: { id: true },
    });
    return [
      room.user(userId),
      ...communityIds.map(room.community),
      ...channels.map((c) => room.channel(c.id)),
    ];
  }

  /** 이 사용자의 온라인 상태를 알아야 하는 방: 같은 커뮤니티들, DM 상대들 */
  async presenceAudience(userId: string): Promise<string[]> {
    const communityIds = await this.communityIdsOf(userId);
    const partners = await this.prisma.channelMember.findMany({
      where: { userId: { not: userId }, channel: { members: { some: { userId } } } },
      select: { userId: true },
      distinct: ['userId'],
    });
    return [...communityIds.map(room.community), ...partners.map((p) => room.user(p.userId))];
  }

  private async communityIdsOf(userId: string): Promise<string[]> {
    const memberships = await this.prisma.communityMember.findMany({
      where: { userId },
      select: { communityId: true },
    });
    return memberships.map((m) => m.communityId);
  }
}
