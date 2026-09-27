import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { isManager } from '@metacode/shared';
import type { ChannelType, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { room } from '../realtime/realtime.service.js';

export interface AccessibleChannel {
  id: string;
  type: ChannelType;
  communityId: string | null;
}

/**
 * 누가 무엇을 볼 수 있는지 한 곳에서 판단한다.
 * - 커뮤니티 채널: 그 커뮤니티의 멤버. 비공개 채널은 소유자, 관리자, 허용된 역할을 가진 멤버만
 * - DM/그룹 DM: 참여자
 * 권한이 없으면 존재 여부도 알려주지 않도록 404로 응답한다.
 *
 * 메시지, 기록, 첨부, 통화, 말풍선이 모두 이 판단(또는 이 판단으로 넣은 채널 방)을 거친다.
 */
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  async getChannel(userId: string, channelId: string): Promise<AccessibleChannel> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, type: true, communityId: true, private: true },
    });
    if (!channel) throw new NotFoundException('채널을 찾을 수 없습니다.');

    const allowed = channel.communityId
      ? await this.canSeeCommunityChannel(userId, { ...channel, communityId: channel.communityId })
      : await this.prisma.channelMember.findUnique({
          where: { channelId_userId: { channelId, userId } },
          select: { userId: true },
        });
    if (!allowed) throw new NotFoundException('채널을 찾을 수 없습니다.');
    return { id: channel.id, type: channel.type, communityId: channel.communityId };
  }

  async getMembership(userId: string, communityId: string) {
    const membership = await this.prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId, userId } },
    });
    if (!membership) throw new NotFoundException('커뮤니티를 찾을 수 없습니다.');
    return membership;
  }

  /** 소유자나 관리자만 할 수 있는 일 (역할, 채널, 권한 관리) */
  async requireManager(userId: string, communityId: string, action: string) {
    const membership = await this.getMembership(userId, communityId);
    if (!isManager(membership.role)) {
      throw new ForbiddenException(`${action}은(는) 관리자만 할 수 있습니다.`);
    }
    return membership;
  }

  /**
   * 이 사용자가 볼 수 있는 채널 조건. 공개 채널, 관리하는 커뮤니티의 모든 채널,
   * 가진 역할이 허용된 비공개 채널, 참여한 DM.
   */
  async visibleChannelsWhere(
    userId: string,
    communityId?: string,
  ): Promise<Prisma.ChannelWhereInput> {
    const memberships = await this.prisma.communityMember.findMany({
      where: { userId, ...(communityId ? { communityId } : {}) },
      select: { communityId: true, role: true },
    });
    const all = memberships.map((m) => m.communityId);
    const managed = memberships.filter((m) => isManager(m.role)).map((m) => m.communityId);
    const community: Prisma.ChannelWhereInput[] = [
      { communityId: { in: managed } },
      { communityId: { in: all }, private: false },
      {
        communityId: { in: all },
        private: true,
        roleAccess: { some: { role: { members: { some: { userId } } } } },
      },
    ];
    return communityId
      ? { OR: community }
      : { OR: [...community, { members: { some: { userId } } }] };
  }

  /** 이 커뮤니티에서 볼 수 있는 채널 ID */
  async visibleChannelIds(userId: string, communityId: string): Promise<string[]> {
    const channels = await this.prisma.channel.findMany({
      where: { AND: [{ communityId }, await this.visibleChannelsWhere(userId, communityId)] },
      select: { id: true },
    });
    return channels.map((c) => c.id);
  }

  /** 접속할 때 들어갈 방: 내 사용자 방, 내 커뮤니티들, 볼 수 있는 모든 채널 */
  async roomsForUser(userId: string): Promise<string[]> {
    const communityIds = await this.communityIdsOf(userId);
    const channels = await this.prisma.channel.findMany({
      where: await this.visibleChannelsWhere(userId),
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

  private async canSeeCommunityChannel(
    userId: string,
    channel: { id: string; communityId: string; private: boolean },
  ): Promise<boolean> {
    const membership = await this.prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId: channel.communityId, userId } },
      select: { role: true },
    });
    if (!membership) return false;
    if (!channel.private || isManager(membership.role)) return true;
    const access = await this.prisma.channelRoleAccess.findFirst({
      where: { channelId: channel.id, role: { members: { some: { userId } } } },
      select: { roleId: true },
    });
    return access !== null;
  }

  private async communityIdsOf(userId: string): Promise<string[]> {
    const memberships = await this.prisma.communityMember.findMany({
      where: { userId },
      select: { communityId: true },
    });
    return memberships.map((m) => m.communityId);
  }
}
