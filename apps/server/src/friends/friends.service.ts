import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type FriendChanged,
  type FriendStatus,
  type FriendsList,
  SocketEvent,
} from '@metacode/shared';
import { Prisma } from '../generated/prisma/client.js';
import { PresenceService } from '../presence/presence.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealtimeService, room } from '../realtime/realtime.service.js';
import { toProfile } from '../users/users.service.js';

/**
 * 친구: 사용자 ID로 요청 → 상대가 수락하면 친구. 두 사람 사이에는 줄이 하나뿐이다 (방향은 요청한 쪽 → 받은 쪽).
 * 거절·취소·친구 끊기는 줄을 지운다. 바뀔 때마다 두 사람 모두에게 friend:updated를 보낸다.
 */
@Injectable()
export class FriendsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(userId: string): Promise<FriendsList> {
    const rows = await this.prisma.friendship.findMany({
      where: { OR: [{ requesterId: userId }, { addresseeId: userId }] },
      include: { requester: true, addressee: true },
      orderBy: { createdAt: 'desc' },
    });
    const otherOf = (row: (typeof rows)[number]) =>
      row.requesterId === userId ? row.addressee : row.requester;
    const online = await this.presence.getOnline(rows.map((row) => otherOf(row).id));
    const result: FriendsList = { friends: [], incoming: [], outgoing: [] };
    for (const row of rows) {
      const other = otherOf(row);
      const base = { user: toProfile(other), online: online[other.id] ?? false };
      if (row.status === 'ACCEPTED') {
        result.friends.push({ ...base, since: (row.acceptedAt ?? row.createdAt).toISOString() });
      } else if (row.addresseeId === userId) {
        result.incoming.push({ ...base, createdAt: row.createdAt.toISOString() });
      } else {
        result.outgoing.push({ ...base, createdAt: row.createdAt.toISOString() });
      }
    }
    const name = (f: { user: { displayName: string | null; username: string } }) =>
      f.user.displayName ?? f.user.username;
    result.friends.sort((a, b) => name(a).localeCompare(name(b), 'ko'));
    return result;
  }

  /** 친구 요청. 상대의 요청이 이미 와 있으면 바로 친구가 된다 */
  async request(userId: string, username: string): Promise<FriendChanged> {
    const target = await this.prisma.user.findFirst({
      where: { username: { equals: username, mode: 'insensitive' } },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('그 사용자 ID로 MetaCode에 로그인한 사람이 없습니다.');
    if (target.id === userId)
      throw new BadRequestException('나에게는 친구 요청을 보낼 수 없습니다.');

    const existing = await this.between(userId, target.id);
    if (existing?.status === 'ACCEPTED') throw new ConflictException('이미 친구입니다.');
    if (existing?.requesterId === userId)
      throw new ConflictException('이미 친구 요청을 보냈습니다.');
    if (existing) return this.accept(userId, target.id);

    try {
      await this.prisma.friendship.create({
        data: { requesterId: userId, addresseeId: target.id },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('이미 친구 요청을 보냈습니다.');
      }
      throw error;
    }
    this.notify(userId, target.id, 'outgoing', 'incoming');
    return { userId: target.id, status: 'outgoing' };
  }

  /** 받은 요청 수락 */
  async accept(userId: string, otherId: string): Promise<FriendChanged> {
    const updated = await this.prisma.friendship.updateMany({
      where: { requesterId: otherId, addresseeId: userId, status: 'PENDING' },
      data: { status: 'ACCEPTED', acceptedAt: new Date() },
    });
    if (updated.count === 0) throw new NotFoundException('받은 친구 요청이 없습니다.');
    this.notify(userId, otherId, 'friends', 'friends');
    return { userId: otherId, status: 'friends' };
  }

  /** 받은 요청 거절, 보낸 요청 취소, 친구 끊기 */
  async remove(userId: string, otherId: string): Promise<FriendChanged> {
    const deleted = await this.prisma.friendship.deleteMany({
      where: {
        OR: [
          { requesterId: userId, addresseeId: otherId },
          { requesterId: otherId, addresseeId: userId },
        ],
      },
    });
    if (deleted.count === 0) throw new NotFoundException('친구나 친구 요청이 없습니다.');
    this.notify(userId, otherId, 'none', 'none');
    return { userId: otherId, status: 'none' };
  }

  private between(a: string, b: string) {
    return this.prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: a, addresseeId: b },
          { requesterId: b, addresseeId: a },
        ],
      },
    });
  }

  /** 두 사람의 모든 연결(다른 탭·기기 포함)에 알린다. 상대 기준의 관계를 담는다 */
  private notify(userId: string, otherId: string, mine: FriendStatus, theirs: FriendStatus) {
    this.realtime.emit(room.user(userId), SocketEvent.FriendUpdated, {
      userId: otherId,
      status: mine,
    });
    this.realtime.emit(room.user(otherId), SocketEvent.FriendUpdated, {
      userId,
      status: theirs,
    });
  }
}
