import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  type AssetCollision,
  type AssetManifest,
  type AssetRef,
  type CommunityMapDto,
  type MapDefinition,
  type MapLayout,
  type PlazaId,
  type PlazaMap,
  type PlazaStyle,
  SocketEvent,
  buildCollision,
  getPlazaMap,
  hasStandableSpawn,
  isBuiltinRef,
  mapAssetProblems,
  mapStyle,
  parsePlazaId,
} from '@metacode/shared';
import { BUILTIN_LAYOUTS, BUILTIN_MAPS, builtinAsset } from '@metacode/shared/builtin-assets';
import type { Redis } from 'ioredis';
import { AccessService } from '../chat/access.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { REDIS } from '../redis/redis.module.js';

/** 광장 하나의 맵: 맵 정의, 충돌 격자, 맵에 쓴 직접 만든 에셋과 버전 */
export interface LoadedMap {
  /** 광장 방식에 맞는 내장 맵 (맵 에디터로 꾸몄으면 그 맵의 바탕) */
  plazaMap: PlazaMap;
  definition: MapDefinition;
  layout: MapLayout;
  assets: { id: string; version: string }[];
  custom: boolean;
}

const builtin = (map: PlazaMap): LoadedMap => ({
  plazaMap: map,
  definition: BUILTIN_MAPS[map],
  layout: BUILTIN_LAYOUTS[map],
  assets: [],
  custom: false,
});

/** 맵이 쓰는 에셋 참조 (타일 목록 + 오브젝트) */
function refsOf(map: MapDefinition): AssetRef[] {
  return [...new Set([...map.tiles, ...map.objects.map((o) => o.asset)])];
}

/**
 * 광장의 맵. DM 모닥불 캠프는 늘 내장 맵이고, 커뮤니티 분수 광장은 맵 에디터로 저장한 맵(없으면 내장 맵)이다.
 * 커뮤니티의 광장 방식(탑다운, 횡스크롤)에 맞는 맵만 쓴다: 저장한 맵이 다른 방식이면(방식을 바꿈) 그 방식의
 * 내장 맵을 쓰고, 저장한 맵은 원래 방식으로 되돌릴 때를 위해 남겨 둔다.
 * 이동 검증이 자주 읽으므로 커뮤니티 맵은 서버 메모리에 캐시한다 (Presence처럼 서버 한 대 전제).
 * 맵이나 맵에 쓴 에셋, 광장 방식이 바뀌면 캐시를 버리고, 그 광장의 위치를 지운 뒤 plaza:mapChanged로 알린다.
 */
@Injectable()
export class PlazaMapsService {
  private readonly cache = new Map<string, Promise<LoadedMap>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly realtime: RealtimeService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  load(plazaId: PlazaId): Promise<LoadedMap> {
    const { kind, id } = parsePlazaId(plazaId);
    if (kind === 'dm') return Promise.resolve(builtin(getPlazaMap(plazaId)));
    let loaded = this.cache.get(id);
    if (!loaded) {
      loaded = this.loadCommunity(id);
      this.cache.set(id, loaded);
      loaded.catch(() => this.cache.delete(id));
    }
    return loaded;
  }

  /** 맵 에디터가 여는 맵 (멤버면 볼 수 있다) */
  async get(userId: string, communityId: string): Promise<CommunityMapDto> {
    await this.access.getMembership(userId, communityId);
    const { definition, custom } = await this.load(`community:${communityId}`);
    return { definition, custom };
  }

  /** 맵 저장 (소유자·관리자). 쓰는 에셋은 내장 에셋이나 이 커뮤니티의 에셋이어야 한다 */
  async save(
    userId: string,
    communityId: string,
    definition: MapDefinition,
  ): Promise<CommunityMapDto> {
    await this.access.requireManager(userId, communityId, '광장 맵 바꾸기');
    if (mapStyle(definition) !== (await this.styleOf(communityId))) {
      throw new BadRequestException('광장 방식이 바뀌었습니다. 맵 에디터를 다시 열어 주세요.');
    }
    const custom = await this.customAssets(communityId, refsOf(definition));
    const metaOf = (ref: AssetRef) => builtinAsset(ref) ?? custom.get(ref)?.manifest;
    const problems = mapAssetProblems(definition, metaOf);
    if (problems.length > 0) throw new BadRequestException(problems.join(' '));
    const layout = buildCollision(definition, metaOf);
    if (!hasStandableSpawn(layout)) {
      throw new BadRequestException('스폰 영역에 설 수 있는 칸이 하나도 없습니다.');
    }
    const json = definition as unknown as Prisma.InputJsonValue;
    await this.prisma.communityMap.upsert({
      where: { communityId },
      create: { communityId, definition: json },
      update: { definition: json },
    });
    await this.changed(communityId);
    return { definition, custom: true };
  }

  /** 광장 방식에 맞는 내장 분수 광장으로 되돌리기 (소유자·관리자) */
  async reset(userId: string, communityId: string): Promise<CommunityMapDto> {
    await this.access.requireManager(userId, communityId, '광장 맵 바꾸기');
    await this.prisma.communityMap.deleteMany({ where: { communityId } });
    await this.changed(communityId);
    const map = getPlazaMap(`community:${communityId}`, await this.styleOf(communityId));
    return { definition: BUILTIN_MAPS[map], custom: false };
  }

  /**
   * 저장한 맵이 이 에셋을 쓰는지 (쓰는 에셋은 지울 수 없다). 지금 방식과 다른 방식의 맵이라 쓰지 않고 있어도
   * 되돌리면 다시 쓰므로 저장한 맵을 본다.
   */
  async uses(communityId: string, assetId: string): Promise<boolean> {
    const saved = await this.prisma.communityMap.findUnique({ where: { communityId } });
    return !!saved && refsOf(saved.definition as unknown as MapDefinition).includes(assetId);
  }

  /** 광장 방식이 바뀌었다: 그 방식의 맵으로 다시 불러오게 한다 */
  styleChanged(communityId: string): Promise<void> {
    return this.changed(communityId);
  }

  /** 맵에 쓴 에셋이 바뀌었다: 그림과 충돌이 달라질 수 있으니 다시 불러오게 한다 */
  async assetChanged(communityId: string, assetId: string): Promise<void> {
    if (await this.uses(communityId, assetId)) await this.changed(communityId);
  }

  private async changed(communityId: string): Promise<void> {
    this.cache.delete(communityId);
    const plazaId: PlazaId = `community:${communityId}`;
    // 막힌 칸이 바뀌었을 수 있으니 모두 스폰 지점에서 다시 시작한다.
    await this.redis.del(`plaza:pos:${plazaId}`);
    this.realtime.emit(`community:${communityId}`, SocketEvent.PlazaMapChanged, { plazaId });
  }

  private async styleOf(communityId: string): Promise<PlazaStyle> {
    const community = await this.prisma.community.findUniqueOrThrow({
      where: { id: communityId },
      select: { plazaStyle: true },
    });
    return community.plazaStyle;
  }

  private async loadCommunity(communityId: string): Promise<LoadedMap> {
    const [style, saved] = await Promise.all([
      this.styleOf(communityId),
      this.prisma.communityMap.findUnique({ where: { communityId } }),
    ]);
    const plazaMap = getPlazaMap(`community:${communityId}`, style);
    const definition = saved?.definition as unknown as MapDefinition | undefined;
    if (!definition || mapStyle(definition) !== style) return builtin(plazaMap);
    const custom = await this.customAssets(communityId, refsOf(definition));
    const metaOf = (ref: AssetRef): AssetCollision | undefined =>
      builtinAsset(ref) ?? custom.get(ref)?.manifest;
    return {
      plazaMap,
      definition,
      layout: buildCollision(definition, metaOf),
      assets: [...custom.values()].map((a) => ({ id: a.id, version: a.version })),
      custom: true,
    };
  }

  /** 맵이 쓰는 직접 만든 에셋 중 이 커뮤니티의 것 */
  private async customAssets(communityId: string, refs: AssetRef[]) {
    const ids = refs.filter((ref) => !isBuiltinRef(ref));
    if (ids.length === 0)
      return new Map<string, { id: string; version: string; manifest: AssetManifest }>();
    const assets = await this.prisma.asset.findMany({ where: { id: { in: ids }, communityId } });
    return new Map(
      assets.map((a) => [
        a.id,
        {
          id: a.id,
          version: a.updatedAt.toISOString(),
          manifest: a.manifest as unknown as AssetManifest,
        },
      ]),
    );
  }
}
