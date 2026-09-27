import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type ChannelSummary,
  CommunityRole,
  MAX_ROLES,
  type RoleDto,
  SocketEvent,
} from '@metacode/shared';
import { Prisma, type Role } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealtimeService, room } from '../realtime/realtime.service.js';
import { VoiceService } from '../voice/voice.service.js';
import { AccessService } from './access.service.js';
import { ChannelSummaryService } from './channel-summary.service.js';

/** 순서 바꾸기 요청이 지금 목록과 같은 항목인지 (빠지거나 남는 것 없이) */
export function assertSameSet(current: string[], requested: string[]): void {
  const set = new Set(current);
  if (current.length !== requested.length || !requested.every((id) => set.has(id))) {
    throw new BadRequestException('목록이 바뀌었습니다. 새로 고친 뒤 다시 시도해 주세요.');
  }
}

export const toRoleDto = ({ id, name, color, position }: Role): RoleDto => ({
  id,
  name,
  color,
  position,
});

/**
 * 사용자 정의 역할과 채널 권한 (Discord식).
 * - 역할 만들기/바꾸기/지우기, 멤버에게 역할 주기, 채널 설정(비공개, 볼 수 있는 역할): 소유자와 관리자
 * - 관리자로 올리기/내리기: 소유자만
 * 권한이 바뀌면 syncAccess가 채널 방 구성을 다시 맞추고(볼 수 없게 된 채널의 메시지는 더 받지 않음),
 * 볼 수 없게 된 음성 채널의 통화에서 빼고, 커뮤니티 멤버에게 다시 불러오라고 알린다.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly realtime: RealtimeService,
    private readonly voice: VoiceService,
    private readonly summaries: ChannelSummaryService,
  ) {}

  async createRole(
    userId: string,
    communityId: string,
    data: { name: string; color: string | null },
  ): Promise<RoleDto> {
    await this.access.requireManager(userId, communityId, '역할 만들기');
    const count = await this.prisma.role.count({ where: { communityId } });
    if (count >= MAX_ROLES) {
      throw new BadRequestException(`역할은 ${MAX_ROLES}개까지 만들 수 있습니다.`);
    }
    const role = await this.uniqueName(() =>
      this.prisma.role.create({ data: { communityId, ...data, position: count } }),
    );
    this.notify(communityId);
    return toRoleDto(role);
  }

  async updateRole(
    userId: string,
    communityId: string,
    roleId: string,
    data: { name?: string; color?: string | null },
  ): Promise<RoleDto> {
    await this.access.requireManager(userId, communityId, '역할 바꾸기');
    await this.findRole(communityId, roleId);
    const role = await this.uniqueName(() =>
      this.prisma.role.update({ where: { id: roleId }, data }),
    );
    this.notify(communityId);
    return toRoleDto(role);
  }

  /** 역할 순서 바꾸기 (목록의 위가 이름 색에서 우선) */
  async reorderRoles(userId: string, communityId: string, ids: string[]): Promise<void> {
    await this.access.requireManager(userId, communityId, '역할 순서 바꾸기');
    const roles = await this.prisma.role.findMany({ where: { communityId }, select: { id: true } });
    assertSameSet(
      roles.map((r) => r.id),
      ids,
    );
    await this.prisma.$transaction(
      ids.map((id, position) => this.prisma.role.update({ where: { id }, data: { position } })),
    );
    this.notify(communityId);
  }

  /** 역할을 지우면 그 역할로 볼 수 있던 비공개 채널도 볼 수 없게 된다 */
  async deleteRole(userId: string, communityId: string, roleId: string): Promise<void> {
    await this.access.requireManager(userId, communityId, '역할 지우기');
    await this.findRole(communityId, roleId);
    await this.prisma.role.delete({ where: { id: roleId } });
    await this.syncAccess(communityId);
  }

  /** 멤버의 역할을 이 목록으로 바꾼다 */
  async setMemberRoles(
    userId: string,
    communityId: string,
    targetId: string,
    roleIds: string[],
  ): Promise<void> {
    await this.access.requireManager(userId, communityId, '역할 주기');
    await this.findMember(communityId, targetId);
    await this.assertRoles(communityId, roleIds);
    await this.prisma.$transaction([
      this.prisma.memberRole.deleteMany({ where: { communityId, userId: targetId } }),
      this.prisma.memberRole.createMany({
        data: roleIds.map((roleId) => ({ communityId, userId: targetId, roleId })),
      }),
    ]);
    await this.syncAccess(communityId);
  }

  /** 관리자로 올리거나 내린다. 소유자만 할 수 있고, 소유자 자신은 바꿀 수 없다 */
  async setAdmin(
    userId: string,
    communityId: string,
    targetId: string,
    admin: boolean,
  ): Promise<void> {
    const membership = await this.access.getMembership(userId, communityId);
    if (membership.role !== CommunityRole.Owner) {
      throw new ForbiddenException('관리자는 소유자만 정할 수 있습니다.');
    }
    const target = await this.findMember(communityId, targetId);
    if (target.role === CommunityRole.Owner) {
      throw new BadRequestException('소유자의 역할은 바꿀 수 없습니다.');
    }
    await this.prisma.communityMember.update({
      where: { communityId_userId: { communityId, userId: targetId } },
      data: { role: admin ? CommunityRole.Admin : CommunityRole.Member },
    });
    await this.syncAccess(communityId);
  }

  /** 채널 설정: 이름, 비공개 여부, 볼 수 있는 역할 */
  async updateChannel(
    userId: string,
    channelId: string,
    data: { name?: string; private?: boolean; roleIds?: string[] },
  ): Promise<ChannelSummary> {
    const channel = await this.access.getChannel(userId, channelId);
    if (!channel.communityId) throw new NotFoundException('채널을 찾을 수 없습니다.');
    const communityId = channel.communityId;
    await this.access.requireManager(userId, communityId, '채널 설정');
    if (data.roleIds) await this.assertRoles(communityId, data.roleIds);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (data.roleIds) {
        await tx.channelRoleAccess.deleteMany({ where: { channelId } });
        await tx.channelRoleAccess.createMany({
          data: data.roleIds.map((roleId) => ({ channelId, roleId })),
        });
      }
      return tx.channel.update({
        where: { id: channelId },
        data: { name: data.name, private: data.private },
      });
    });
    await this.syncAccess(communityId);
    const [summary] = await this.summaries.summarize(userId, [updated]);
    return summary!;
  }

  /** 새 채널에 볼 수 있는 역할을 붙일 때 (채널 만들기) */
  async assertRoles(communityId: string, roleIds: string[]): Promise<void> {
    if (roleIds.length === 0) return;
    const count = await this.prisma.role.count({ where: { communityId, id: { in: roleIds } } });
    if (count !== roleIds.length) throw new BadRequestException('이 커뮤니티의 역할이 아닙니다.');
  }

  /**
   * 권한이 바뀐 뒤: 멤버마다 볼 수 있는 채널 방에만 들어가게 하고, 볼 수 없게 된 음성 채널의 통화에서 뺀 뒤,
   * 커뮤니티 멤버에게 다시 불러오라고 알린다.
   */
  async syncAccess(communityId: string): Promise<void> {
    const [channels, members] = await Promise.all([
      this.prisma.channel.findMany({ where: { communityId }, select: { id: true } }),
      this.prisma.communityMember.findMany({ where: { communityId }, select: { userId: true } }),
    ]);
    for (const { userId } of members) {
      const visible = new Set(await this.access.visibleChannelIds(userId, communityId));
      this.realtime.leaveUser(
        userId,
        channels.filter((c) => !visible.has(c.id)).map((c) => room.channel(c.id)),
      );
      this.realtime.joinUser(userId, [...visible].map(room.channel));
    }
    await this.voice.revalidateCommunity(communityId);
    this.notify(communityId);
  }

  notify(communityId: string) {
    this.realtime.emit(room.community(communityId), SocketEvent.CommunityUpdated, { communityId });
  }

  private async findRole(communityId: string, roleId: string) {
    const role = await this.prisma.role.findFirst({ where: { id: roleId, communityId } });
    if (!role) throw new NotFoundException('역할을 찾을 수 없습니다.');
    return role;
  }

  private async findMember(communityId: string, userId: string) {
    const member = await this.prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId, userId } },
    });
    if (!member) throw new NotFoundException('멤버를 찾을 수 없습니다.');
    return member;
  }

  /** 같은 커뮤니티에 같은 이름의 역할이 있으면 알아듣기 쉬운 오류로 바꾼다 */
  private async uniqueName<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('같은 이름의 역할이 이미 있습니다.');
      }
      throw error;
    }
  }
}
