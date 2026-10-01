import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type Direction,
  type MapLayout,
  type PlazaCorrection,
  type PlazaId,
  type PlazaMotionChanged,
  type PlazaMoveRequest,
  type PlazaMoved,
  type PlazaOccupant,
  type PlazaSnapshot,
  type Position,
  DEFAULT_THEME,
  MAX_STEP_MS,
  isGrounded,
  isSideScroll,
  isValidMove,
  isValidSideMove,
  isWalkable,
  moveCostMs,
  nearestWalkable,
  parsePlazaId,
  sideMoveCostMs,
  spawnPosition,
} from '@metacode/shared';
import type { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service.js';
import { PresenceService } from '../presence/presence.service.js';
import { REDIS } from '../redis/redis.module.js';
import { toProfile } from '../users/users.service.js';
import { PlazaMapsService } from './plaza-maps.service.js';

interface StoredPosition {
  x: number;
  y: number;
  dir: Direction;
  moving: boolean;
  /**
   * 이동 시간 기록 (ms). 받아들인 이동에 든 시간(moveCostMs)만큼만 앞으로 가서, 받은 시각보다 늦을 수 있다
   * (지연으로 몰려 온 위치를 받아들일 여유). 다음 이동의 속도 검사에 쓴다
   */
  t: number;
  /** 횡스크롤: 마지막으로 딛은 땅의 높이. 여기서 점프 높이 이상 오르면(날기) 받아들이지 않는다 */
  g?: number;
  /** 반복 중인 캐릭터 모션. 움직이면 멈춘다 */
  m?: string;
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
  /**
   * 사람·광장마다 위치를 고치는 일(이동, 모션)을 하나씩 차례로 한다. 몰려 온 이동을 동시에 처리하면
   * 모두 같은 예전 위치를 읽고 비교해서 뒤의 것이 "너무 멀다"로 되돌려졌다. 서버 한 대 전제 (Presence와 같음)
   */
  private readonly positionLocks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
    private readonly maps: PlazaMapsService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** 이동 검증에 쓰는 충돌 격자 (맵 정의에서 계산, 캐시됨) */
  async layoutOf(plazaId: PlazaId): Promise<MapLayout> {
    return (await this.maps.load(plazaId)).layout;
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

    const map = await this.maps.load(plazaId);
    return {
      plazaId,
      map: map.plazaMap,
      theme: DEFAULT_THEME,
      definition: map.definition,
      assets: map.assets,
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
   * 횡스크롤은 가로·세로 속도와 점프 높이(마지막으로 딛은 땅 기준)를 따로 본다.
   */
  move(userId: string, request: PlazaMoveRequest): Promise<MoveResult> {
    return this.inOrder(request.plazaId, userId, () => this.applyMove(userId, request));
  }

  private async applyMove(userId: string, request: PlazaMoveRequest): Promise<MoveResult> {
    const layout = await this.layoutOf(request.plazaId);
    const now = Date.now();
    const current = await this.positionOf(request.plazaId, userId, layout);
    const side = isSideScroll(layout);
    const ground = current.g ?? current.y;
    // 남겨 둘 수 있는 시간은 MAX_STEP_MS까지: 오래 멈춰 있었어도 한 번에 멀리 가지는 못한다.
    const clock = Math.max(current.t, now - MAX_STEP_MS);
    const valid = side
      ? isValidSideMove(layout, current, request, now - clock, ground)
      : isValidMove(layout, current, request, now - clock);
    if (!valid) {
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
      t: clock + (side ? sideMoveCostMs : moveCostMs)(current, request),
      ...(side ? { g: isGrounded(layout, request.x, request.y) ? request.y : ground } : {}),
      // 움직이면 반복 중이던 모션은 멈춘다
      ...(!request.moving && current.m ? { m: current.m } : {}),
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

  /**
   * 캐릭터 모션을 틀거나 멈춘다. 반복 모션은 나중에 광장을 연 사람에게도 보이도록 위치와 함께 저장한다.
   * 모션이 있는지는 확인하지 않는다 (없으면 보는 쪽에서 대기 모습으로 보인다).
   */
  setMotion(
    userId: string,
    plazaId: PlazaId,
    motion: string | null,
    loop: boolean,
  ): Promise<PlazaMotionChanged> {
    return this.inOrder(plazaId, userId, () => this.applyMotion(userId, plazaId, motion, loop));
  }

  private async applyMotion(
    userId: string,
    plazaId: PlazaId,
    motion: string | null,
    loop: boolean,
  ): Promise<PlazaMotionChanged> {
    const layout = await this.layoutOf(plazaId);
    const current = await this.positionOf(plazaId, userId, layout);
    const next: StoredPosition = { ...current };
    if (motion && loop) next.m = motion;
    else delete next.m;
    await this.redis.hset(positionsKey(plazaId), userId, JSON.stringify(next));
    return { plazaId, userId, motion, loop };
  }

  /** 여러 사람의 이 광장 위치 (근접 음성 거리 계산). 처음이면 스폰 자리 */
  async positions(plazaId: PlazaId, userIds: string[]): Promise<Record<string, Position>> {
    const layout = await this.layoutOf(plazaId);
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
    const layout = await this.layoutOf(plazaId);
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds } } });
    const positions = await Promise.all(users.map((u) => this.positionOf(plazaId, u.id, layout)));
    return users.map((user, i) => ({
      user: toProfile(user),
      x: positions[i]!.x,
      y: positions[i]!.y,
      dir: positions[i]!.dir,
      moving: false,
      motion: positions[i]!.m ?? null,
    }));
  }

  /** 같은 사람·광장의 위치 일은 앞의 것이 끝난 뒤에 한다 (positionLocks) */
  private inOrder<T>(plazaId: PlazaId, userId: string, task: () => Promise<T>): Promise<T> {
    const key = `${plazaId}|${userId}`;
    const run = (this.positionLocks.get(key) ?? Promise.resolve()).then(task, task);
    const tail = run.catch(() => undefined);
    this.positionLocks.set(key, tail);
    void tail.then(() => {
      if (this.positionLocks.get(key) === tail) this.positionLocks.delete(key);
    });
    return run;
  }

  /** 저장된 위치. 처음이면 스폰 지점, 장애물 속이면 가장 가까운 설 수 있는 자리에 두고 저장한다. */
  private async positionOf(
    plazaId: PlazaId,
    userId: string,
    layout: MapLayout,
  ): Promise<StoredPosition> {
    const raw = await this.redis.hget(positionsKey(plazaId), userId);
    const stored = raw ? (JSON.parse(raw) as StoredPosition) : null;
    if (stored && isWalkable(layout, stored.x, stored.y)) return stored;
    // 처음이거나, 저장된 자리가 장애물 속이면(내장 맵이 바뀐 배포 등) 가장 가까운 설 수 있는 자리로 옮긴다.
    const spawn = (stored && nearestWalkable(layout, stored)) || spawnPosition(layout, userId);
    const position: StoredPosition = {
      ...spawn,
      dir: stored?.dir ?? 'down',
      moving: false,
      t: 0,
      ...(isSideScroll(layout) ? { g: spawn.y } : {}),
    };
    await this.redis.hset(positionsKey(plazaId), userId, JSON.stringify(position));
    return position;
  }
}
