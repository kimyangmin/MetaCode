import { randomInt } from 'node:crypto';
import { ForbiddenException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type ChannelSummary,
  type CommunityMember,
  CommunityRole,
  type CommunitySummary,
  type InviteInfo,
  SocketEvent,
} from '@metacode/shared';
import { AttachmentsService } from '../attachments/attachments.service.js';
import { PlazaService } from '../plaza/plaza.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PresenceService } from '../presence/presence.service.js';
import { RealtimeService, room } from '../realtime/realtime.service.js';
import { toProfile } from '../users/users.service.js';
import { VoiceService } from '../voice/voice.service.js';
import { AccessService } from './access.service.js';
import { ChannelSummaryService } from './channel-summary.service.js';

export const DEFAULT_CHANNEL_NAME = '일반';
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

@Injectable()
export class CommunitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly summaries: ChannelSummaryService,
    private readonly presence: PresenceService,
    private readonly realtime: RealtimeService,
    private readonly attachments: AttachmentsService,
    private readonly plaza: PlazaService,
    private readonly voice: VoiceService,
  ) {}

  /** 커뮤니티를 만들고 만든 사람을 OWNER로, 기본 텍스트 채널 하나를 함께 만든다. */
  async create(userId: string, name: string): Promise<CommunitySummary> {
    const community = await this.prisma.community.create({
      data: {
        name,
        ownerId: userId,
        members: { create: { userId, role: CommunityRole.Owner } },
        channels: { create: { type: 'TEXT', name: DEFAULT_CHANNEL_NAME } },
      },
      include: { channels: true },
    });
    this.realtime.joinUser(userId, [
      room.community(community.id),
      ...community.channels.map((c) => room.channel(c.id)),
    ]);
    return {
      id: community.id,
      name: community.name,
      myRole: CommunityRole.Owner,
      channels: await this.summaries.summarize(userId, community.channels),
    };
  }

  async list(userId: string): Promise<CommunitySummary[]> {
    const memberships = await this.prisma.communityMember.findMany({
      where: { userId },
      orderBy: { joinedAt: 'asc' },
      include: {
        community: {
          include: { channels: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] } },
        },
      },
    });
    const allChannels = memberships.flatMap((m) => m.community.channels);
    const summaries = new Map(
      (await this.summaries.summarize(userId, allChannels)).map((s) => [s.id, s]),
    );
    return memberships.map((m) => ({
      id: m.community.id,
      name: m.community.name,
      myRole: m.role,
      channels: m.community.channels.map((c) => summaries.get(c.id)!),
    }));
  }

  async members(userId: string, communityId: string): Promise<CommunityMember[]> {
    await this.access.getMembership(userId, communityId);
    const members = await this.prisma.communityMember.findMany({
      where: { communityId },
      include: { user: true },
      orderBy: { joinedAt: 'asc' },
    });
    const online = await this.presence.getOnline(members.map((m) => m.userId));
    return members.map((m) => ({
      user: toProfile(m.user),
      role: m.role,
      online: online[m.userId] ?? false,
    }));
  }

  async createChannel(
    userId: string,
    communityId: string,
    name: string,
    type: 'TEXT' | 'VOICE',
  ): Promise<ChannelSummary> {
    const membership = await this.access.getMembership(userId, communityId);
    if (membership.role === CommunityRole.Member) {
      throw new ForbiddenException('채널은 관리자만 만들 수 있습니다.');
    }
    const last = await this.prisma.channel.findFirst({
      where: { communityId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const channel = await this.prisma.channel.create({
      data: { type, communityId, name, position: (last?.position ?? 0) + 1 },
    });
    const [summary] = await this.summaries.summarize(userId, [channel]);
    // 커뮤니티 멤버 전원의 연결을 새 채널 방에 넣고 알린다.
    this.realtime.joinRoom(room.community(communityId), [room.channel(channel.id)]);
    this.realtime.emit(room.community(communityId), SocketEvent.ChannelCreated, summary!);
    return summary!;
  }

  async leave(userId: string, communityId: string): Promise<void> {
    const membership = await this.access.getMembership(userId, communityId);
    if (membership.role === CommunityRole.Owner) {
      throw new ForbiddenException('소유자는 나갈 수 없습니다. 커뮤니티를 삭제해 주세요.');
    }
    const channels = await this.prisma.channel.findMany({
      where: { communityId },
      select: { id: true },
    });
    await this.prisma.communityMember.delete({
      where: { communityId_userId: { communityId, userId } },
    });
    await this.voice.leftCommunity(userId, communityId);
    const plazaId = `community:${communityId}` as const;
    this.realtime.leaveUser(userId, [
      room.community(communityId),
      room.plaza(plazaId),
      ...channels.map((c) => room.channel(c.id)),
    ]);
    // 광장을 보고 있는 멤버들 화면에서 캐릭터를 없앤다.
    this.realtime.emit(room.plaza(plazaId), SocketEvent.PlazaMember, {
      plazaId,
      userId,
      occupant: null,
    });
    // 남은 멤버와, 이 사용자의 다른 탭/기기에 알린다.
    this.realtime.emit(
      [room.community(communityId), room.user(userId)],
      SocketEvent.CommunityMemberLeft,
      {
        communityId,
        userId,
      },
    );
  }

  async remove(userId: string, communityId: string): Promise<void> {
    const membership = await this.access.getMembership(userId, communityId);
    if (membership.role !== CommunityRole.Owner) {
      throw new ForbiddenException('소유자만 커뮤니티를 삭제할 수 있습니다.');
    }
    const channels = await this.prisma.channel.findMany({
      where: { communityId },
      select: { id: true },
    });
    // DB의 첨부 행은 연쇄 삭제되지만 저장소의 파일은 따로 지운다.
    const fileKeys = await this.attachments.keysInCommunity(communityId);
    await this.prisma.community.delete({ where: { id: communityId } });
    await this.voice.communityDeleted(communityId);
    void this.attachments.removeObjects(fileKeys);
    this.realtime.emit(room.community(communityId), SocketEvent.CommunityDeleted, { communityId });
    for (const target of [
      room.community(communityId),
      room.plaza(`community:${communityId}`),
      ...channels.map((c) => room.channel(c.id)),
    ]) {
      this.realtime.clearRoom(target);
    }
  }

  async createInvite(userId: string, communityId: string): Promise<InviteInfo> {
    await this.access.getMembership(userId, communityId);
    const code = Array.from(
      { length: 8 },
      () => INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)],
    ).join('');
    await this.prisma.invite.create({
      data: {
        code,
        communityId,
        createdById: userId,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });
    return this.inviteInfo(userId, code);
  }

  async inviteInfo(userId: string, code: string): Promise<InviteInfo> {
    const invite = await this.findValidInvite(code);
    const [memberCount, membership] = await Promise.all([
      this.prisma.communityMember.count({ where: { communityId: invite.communityId } }),
      this.prisma.communityMember.findUnique({
        where: { communityId_userId: { communityId: invite.communityId, userId } },
        select: { userId: true },
      }),
    ]);
    return {
      code: invite.code,
      communityId: invite.communityId,
      communityName: invite.community.name,
      memberCount,
      expiresAt: invite.expiresAt?.toISOString() ?? null,
      joined: membership !== null,
    };
  }

  /** 초대를 수락한다. 이미 멤버면 아무것도 바꾸지 않고 커뮤니티를 돌려준다. */
  async acceptInvite(userId: string, code: string): Promise<CommunitySummary> {
    const invite = await this.findValidInvite(code);
    const communityId = invite.communityId;
    const existing = await this.prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId, userId } },
    });

    if (!existing) {
      const [member] = await this.prisma.$transaction([
        this.prisma.communityMember.create({
          data: { communityId, userId, role: CommunityRole.Member },
          include: { user: true },
        }),
        this.prisma.invite.update({ where: { code }, data: { uses: { increment: 1 } } }),
      ]);
      const channels = await this.prisma.channel.findMany({
        where: { communityId },
        select: { id: true },
      });
      this.realtime.joinUser(userId, [
        room.community(communityId),
        ...channels.map((c) => room.channel(c.id)),
      ]);
      const [online] = Object.values(await this.presence.getOnline([userId]));
      this.realtime.emit(room.community(communityId), SocketEvent.CommunityMemberJoined, {
        communityId,
        member: { user: toProfile(member.user), role: member.role, online: online ?? false },
      });
      // 접속 중이면 광장에도 바로 나타난다.
      if (online) {
        const plazaId = `community:${communityId}` as const;
        this.realtime.emit(room.plaza(plazaId), SocketEvent.PlazaMember, {
          plazaId,
          userId,
          occupant: await this.plaza.occupant(plazaId, userId),
        });
      }
    }

    const community = (await this.list(userId)).find((c) => c.id === communityId);
    if (!community) throw new NotFoundException('커뮤니티를 찾을 수 없습니다.');
    return community;
  }

  private async findValidInvite(code: string) {
    const invite = await this.prisma.invite.findUnique({
      where: { code },
      include: { community: { select: { name: true } } },
    });
    if (!invite) throw new NotFoundException('초대 링크가 올바르지 않습니다.');
    if (invite.expiresAt && invite.expiresAt.getTime() <= Date.now()) {
      throw new GoneException('초대 링크가 만료되었습니다.');
    }
    return invite;
  }
}
