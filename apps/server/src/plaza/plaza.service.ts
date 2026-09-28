import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type Direction,
  type MapDefinition,
  type MapLayout,
  type PlazaCorrection,
  type PlazaId,
  type PlazaMoveRequest,
  type PlazaMoved,
  type PlazaOccupant,
  type PlazaSnapshot,
  type Position,
  DEFAULT_THEME,
  getPlazaMap,
  isValidMove,
  parsePlazaId,
  spawnPosition,
} from '@metacode/shared';
import { BUILTIN_LAYOUTS, BUILTIN_MAPS } from '@metacode/shared/builtin-assets';
import type { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service.js';
import { PresenceService } from '../presence/presence.service.js';
import { REDIS } from '../redis/redis.module.js';
import { toProfile } from '../users/users.service.js';

interface StoredPosition {
  x: number;
  y: number;
  dir: Direction;
  moving: boolean;
  /** 마지막으로 받아들인 시각 (ms). 다음 이동의 속도 검사에 쓴다 */
  t: number;
}

/** 광장 위치는 휘발성이라 Redis에만 둔다 (설계 원칙). 광장마다 해시 하나: userId → 위치 */
const positionsKey = (plazaId: PlazaId) => `plaza:pos:${plazaId}`;

export type MoveResult =
  { ok: true; moved: PlazaMoved } | { ok: false; correction: PlazaCorrection };

/**
 * 광장 = 커뮤니티 또는 DM에 1:1로 딸린 메타버스 공간.
 * 광장 인원은 그 커뮤니티(DM) 멤버 중 온라인인 사람 전부이고, 위치는 광장마다 따로 유지한다.
 */
@Injectable()
export class PlazaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** 광장의 맵 정의. 지금은 내장 맵(분수 광장, 모닥불 캠프)이다 */
  mapOf(plazaId: PlazaId): MapDefinition {
    return BUILTIN_MAPS[getPlazaMap(plazaId)];
  }

  /** 이동 검증에 쓰는 충돌 격자 (맵 정의에서 계산) */
  layoutOf(plazaId: PlazaId): MapLayout {
    return BUILTIN_LAYOUTS[getPlazaMap(plazaId)];
  }

  /** 광장의 멤버(온라인 여부와 상관없이) */
  async memberIds(plazaId: PlazaId): Promise<string[]> {
    const { kind, id } = parsePlazaId(plazaId);
    if (kind === 'community') {
      const members = await this.prisma.communityMember.findMany({
        where: { communityId: id },
        select: { userId: true },
      });
      return members.map((m) => m.userId);
    }
    const members = await this.prisma.channelMember.findMany({
      where: { channelId: id, channel: { communityId: null } },
      select: { userId: true },
    });
    return members.map((m) => m.userId);
  }

  /** 멤버가 아니면 광장이 있는지도 알려주지 않는다 (404) */
  async assertMember(userId: string, plazaId: PlazaId): Promise<void> {
    if (!(await this.memberIds(plazaId)).includes(userId)) {
      throw new NotFoundException('광장을 찾을 수 없습니다.');
    }
  }

  /** 이 사용자가 나타나는 모든 광장: 속한 커뮤니티들과 DM들 */
  async plazaIdsOf(userId: string): Promise<PlazaId[]> {
    const [communities, dms] = await Promise.all([
      this.prisma.communityMember.findMany({ where: { userId }, select: { communityId: true } }),
      this.prisma.channelMember.findMany({
        where: { userId, channel: { communityId: null } },
        select: { channelId: true },
      }),
    ]);
    return [
      ...communities.map((c) => `community:${c.communityId}` as const),
      ...dms.map((d) => `dm:${d.channelId}` as const),
    ];
  }

  async snapshot(userId: string, plazaId: PlazaId): Promise<PlazaSnapshot> {
    const memberIds = await this.memberIds(plazaId);
    if (!memberIds.includes(userId)) throw new NotFoundException('광장을 찾을 수 없습니다.');

    const online = await this.presence.getOnline(memberIds);
    const onlineIds = memberIds.filter((id) => online[id]);
    // 광장을 여는 사람은 지금 접속 중이다 (연결 직후 Presence 기록 전일 수 있어 직접 넣는다).
    if (!onlineIds.includes(userId)) onlineIds.push(userId);

    return {
      plazaId,
      map: getPlazaMap(plazaId),
      theme: DEFAULT_THEME,
      definition: this.mapOf(plazaId),
      occupants: await this.occupants(plazaId, onlineIds),
    };
  }

  /** 온라인이 되어 광장에 나타날 때 알릴 정보 */
  async occupant(plazaId: PlazaId, userId: string): Promise<PlazaOccupant | null> {
    const [occupant] = await this.occupants(plazaId, [userId]);
    return occupant ?? null;
  }

  /**
   * 클라이언트가 보낸 위치를 검사한다. 마지막으로 받아들인 위치에서 속도상 갈 수 있고
   * 장애물을 지나지 않았으면 저장하고, 아니면 되돌릴 위치를 돌려준다.
   */
  async move(userId: string, request: PlazaMoveRequest): Promise<MoveResult> {
    const layout = this.layoutOf(request.plazaId);
    const now = Date.now();
    const current = await this.positionOf(request.plazaId, userId, layout);
    if (!isValidMove(layout, current, request, now - current.t)) {
      return {
        ok: false,
        correction: { plazaId: request.plazaId, x: current.x, y: current.y, dir: current.dir },
      };
    }
    const next: StoredPosition = {
      x: request.x,
      y: request.y,
      dir: request.dir,
      moving: request.moving,
      t: now,
    };
    await this.redis.hset(positionsKey(request.plazaId), userId, JSON.stringify(next));
    return {
      ok: true,
      moved: {
        plazaId: request.plazaId,
        userId,
        x: next.x,
        y: next.y,
        dir: next.dir,
        moving: next.moving,
      },
    };
  }

  /** 여러 사람의 이 광장 위치 (근접 음성 거리 계산). 처음이면 스폰 자리 */
  async positions(plazaId: PlazaId, userIds: string[]): Promise<Record<string, Position>> {
    const layout = this.layoutOf(plazaId);
    const entries = await Promise.all(
      userIds.map(async (id) => {
        const { x, y } = await this.positionOf(plazaId, id, layout);
        return [id, { x, y }] as const;
      }),
    );
    return Object.fromEntries(entries);
  }

  private async occupants(plazaId: PlazaId, userIds: string[]): Promise<PlazaOccupant[]> {
    if (userIds.length === 0) return [];
    const layout = this.layoutOf(plazaId);
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds } } });
    const positions = await Promise.all(users.map((u) => this.positionOf(plazaId, u.id, layout)));
    return users.map((user, i) => ({
      user: toProfile(user),
      x: positions[i]!.x,
      y: positions[i]!.y,
      dir: positions[i]!.dir,
      moving: false,
    }));
  }

  /** 저장된 위치. 처음이면 스폰 지점에 두고 저장한다. */
  private async positionOf(
    plazaId: PlazaId,
    userId: string,
    layout: MapLayout,
  ): Promise<StoredPosition> {
    const raw = await this.redis.hget(positionsKey(plazaId), userId);
    if (raw) return JSON.parse(raw) as StoredPosition;
    const spawn = spawnPosition(layout, userId);
    const position: StoredPosition = { ...spawn, dir: 'down', moving: false, t: 0 };
    await this.redis.hset(positionsKey(plazaId), userId, JSON.stringify(position));
    return position;
  }
}
