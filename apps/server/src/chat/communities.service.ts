import { randomInt } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
import { RolesService, assertSameSet, toRoleDto } from './roles.service.js';

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
    private readonly roles: RolesService,
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
      roles: [],
    };
  }

  async list(userId: string): Promise<CommunitySummary[]> {
    const memberships = await this.prisma.communityMember.findMany({
      where: { userId },
      orderBy: { joinedAt: 'asc' },
      include: {
        community: {
          include: {
            // 볼 수 있는 채널만 (비공개 채널은 권한이 있을 때만)
            channels: {
              where: await this.access.visibleChannelsWhere(userId),
              orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
            },
            roles: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
          },
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
      roles: m.community.roles.map(toRoleDto),
    }));
  }

  async members(userId: string, communityId: string): Promise<CommunityMember[]> {
    await this.access.getMembership(userId, communityId);
    const members = await this.prisma.communityMember.findMany({
      where: { communityId },
      include: { user: true, roles: { select: { roleId: true } } },
      orderBy: { joinedAt: 'asc' },
    });
    const online = await this.presence.getOnline(members.map((m) => m.userId));
    return members.map((m) => ({
      user: toProfile(m.user),
      role: m.role,
      roleIds: m.roles.map((r) => r.roleId),
      online: online[m.userId] ?? false,
    }));
  }

  async createChannel(
    userId: string,
    communityId: string,
    request: { name: string; type: 'TEXT' | 'VOICE'; private: boolean; roleIds: string[] },
  ): Promise<ChannelSummary> {
    await this.access.requireManager(userId, communityId, '채널 만들기');
    await this.roles.assertRoles(communityId, request.roleIds);
    const last = await this.prisma.channel.findFirst({
      where: { communityId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const channel = await this.prisma.channel.create({
      data: {
        type: request.type,
        communityId,
        name: request.name,
        private: request.private,
        position: (last?.position ?? 0) + 1,
        roleAccess: { create: request.roleIds.map((roleId) => ({ roleId })) },
      },
    });
    const [summary] = await this.summaries.summarize(userId, [channel]);
    // 비공개 채널은 볼 수 있는 사람만 방에 넣고, 커뮤니티 정보를 다시 불러오게 한다.
    if (channel.private) {
      await this.roles.syncAccess(communityId);
      return summary!;
    }
    // 커뮤니티 멤버 전원의 연결을 새 채널 방에 넣고 알린다.
    this.realtime.joinRoom(room.community(communityId), [room.channel(channel.id)]);
    this.realtime.emit(room.community(communityId), SocketEvent.ChannelCreated, summary!);
    return summary!;
  }

  /**
   * 채널 삭제 (소유자, 관리자). 메시지와 첨부(저장소 파일 포함)도 지우고, 그 채널의 통화를 끝낸다.
   * 텍스트 채널은 하나는 남아야 한다 (커뮤니티를 열면 첫 텍스트 채널을 보여 준다).
   */
  async deleteChannel(userId: string, channelId: string): Promise<void> {
    const channel = await this.access.getChannel(userId, channelId);
    if (!channel.communityId) throw new NotFoundException('채널을 찾을 수 없습니다.');
    const communityId = channel.communityId;
    await this.access.requireManager(userId, communityId, '채널 삭제');
    if (channel.type === 'TEXT') {
      const texts = await this.prisma.channel.count({ where: { communityId, type: 'TEXT' } });
      if (texts <= 1) throw new BadRequestException('텍스트 채널은 하나 이상 있어야 합니다.');
    }
    const fileKeys = await this.attachments.keysInChannel(channelId);
    await this.voice.channelDeleted(channelId);
    await this.prisma.channel.delete({ where: { id: channelId } });
    void this.attachments.removeObjects(fileKeys);
    this.realtime.emit(room.channel(channelId), SocketEvent.ChannelDeleted, {
      channelId,
      communityId,
    });
    this.realtime.clearRoom(room.channel(channelId));
  }

  /** 채널 순서 바꾸기 (소유자, 관리자). 커뮤니티의 모든 채널을 새 순서대로 보낸다 */
  async reorderChannels(userId: string, communityId: string, ids: string[]): Promise<void> {
    await this.access.requireManager(userId, communityId, '채널 순서 바꾸기');
    const channels = await this.prisma.channel.findMany({
      where: { communityId },
      select: { id: true },
    });
    assertSameSet(
      channels.map((c) => c.id),
      ids,
    );
    await this.prisma.$transaction(
      ids.map((id, position) => this.prisma.channel.update({ where: { id }, data: { position } })),
    );
    this.roles.notify(communityId);
  }

  async leave(userId: string, communityId: string): Promise<void> {
    const membership = await this.access.getMembership(userId, communityId);
    if (membership.role === CommunityRole.Owner) {
      throw new ForbiddenException('소유자는 나갈 수 없습니다. 커뮤니티를 삭제해 주세요.');
    }
    await this.removeMember(communityId, userId);
  }

  /**
   * 멤버 내보내기 (소유자, 관리자). 소유자는 내보낼 수 없고, 관리자는 소유자만 내보낼 수 있다.
   * 나간 것과 같이 처리하므로 본인 화면에서도 커뮤니티가 사라진다.
   */
  async kick(userId: string, communityId: string, targetId: string): Promise<void> {
    const actor = await this.access.requireManager(userId, communityId, '멤버 내보내기');
    if (targetId === userId)
      throw new BadRequestException('나가려면 커뮤니티 나가기를 눌러 주세요.');
    const target = await this.prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId, userId: targetId } },
    });
    if (!target) throw new NotFoundException('멤버를 찾을 수 없습니다.');
    if (target.role === CommunityRole.Owner) {
      throw new ForbiddenException('소유자는 내보낼 수 없습니다.');
    }
    if (target.role === CommunityRole.Admin && actor.role !== CommunityRole.Owner) {
      throw new ForbiddenException('관리자는 소유자만 내보낼 수 있습니다.');
    }
    await this.removeMember(communityId, targetId);
  }

  /** 멤버를 뺀다 (나가기, 내보내기): 방에서 빼고, 통화에서 빼고, 광장에서 없애고, 알린다 */
  private async removeMember(communityId: string, userId: string): Promise<void> {
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
      // 새 멤버는 역할이 없으므로 공개 채널만 본다.
      const channelIds = await this.access.visibleChannelIds(userId, communityId);
      this.realtime.joinUser(userId, [
        room.community(communityId),
        ...channelIds.map(room.channel),
      ]);
      const [online] = Object.values(await this.presence.getOnline([userId]));
      this.realtime.emit(room.community(communityId), SocketEvent.CommunityMemberJoined, {
        communityId,
        member: {
          user: toProfile(member.user),
          role: member.role,
          roleIds: [],
          online: online ?? false,
        },
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
