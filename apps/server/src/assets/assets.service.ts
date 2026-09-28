import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type AssetDto,
  AssetKind,
  type AssetManifest,
  CHARACTER_ASSET_LIMIT,
  COMMUNITY_ASSET_LIMIT,
} from '@metacode/shared';
import { AccessService } from '../chat/access.service.js';
import type { Asset, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const KIND_TO_DB = {
  [AssetKind.Tile]: 'TILE',
  [AssetKind.Object]: 'OBJECT',
  [AssetKind.Character]: 'CHARACTER',
} as const;

export function toAssetDto(asset: Asset): AssetDto {
  const manifest = asset.manifest as unknown as AssetManifest;
  return {
    id: asset.id,
    kind: manifest.kind,
    name: asset.name,
    communityId: asset.communityId,
    creatorId: asset.creatorId,
    manifest,
    updatedAt: asset.updatedAt.toISOString(),
  };
}

/**
 * 도트 에디터로 만든 에셋. 캐릭터는 만든 사람만 고치고, 광장에서 그려야 하므로 로그인한 누구나 읽는다.
 * 타일·오브젝트는 커뮤니티의 것이라 멤버만 읽고 소유자·관리자만 만들고 고친다.
 * 권한이 없으면 있는지도 알려 주지 않는다 (404).
 */
@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  async listMine(userId: string): Promise<AssetDto[]> {
    const assets = await this.prisma.asset.findMany({
      where: { creatorId: userId, kind: 'CHARACTER' },
      orderBy: { id: 'asc' },
    });
    return assets.map(toAssetDto);
  }

  async listCommunity(userId: string, communityId: string): Promise<AssetDto[]> {
    await this.access.getMembership(userId, communityId);
    const assets = await this.prisma.asset.findMany({
      where: { communityId },
      orderBy: { id: 'asc' },
    });
    return assets.map(toAssetDto);
  }

  async get(userId: string, id: string): Promise<AssetDto> {
    return toAssetDto(await this.readable(userId, id));
  }

  async create(
    userId: string,
    communityId: string | null,
    manifest: AssetManifest,
  ): Promise<AssetDto> {
    if (manifest.kind === AssetKind.Character) {
      if (communityId) throw new BadRequestException('캐릭터는 커뮤니티에 만들 수 없습니다.');
      const count = await this.prisma.asset.count({
        where: { creatorId: userId, kind: 'CHARACTER' },
      });
      if (count >= CHARACTER_ASSET_LIMIT) {
        throw new ConflictException(`캐릭터는 ${CHARACTER_ASSET_LIMIT}개까지 만들 수 있습니다.`);
      }
    } else {
      if (!communityId) {
        throw new BadRequestException('타일과 오브젝트는 커뮤니티에 만듭니다.');
      }
      await this.access.requireManager(userId, communityId, '에셋 만들기');
      const count = await this.prisma.asset.count({ where: { communityId } });
      if (count >= COMMUNITY_ASSET_LIMIT) {
        throw new ConflictException(
          `커뮤니티 하나에 타일·오브젝트는 ${COMMUNITY_ASSET_LIMIT}개까지 만들 수 있습니다.`,
        );
      }
    }
    const asset = await this.prisma.asset.create({
      data: {
        kind: KIND_TO_DB[manifest.kind],
        name: manifest.name,
        creatorId: userId,
        communityId,
        manifest: manifest as unknown as Prisma.InputJsonValue,
      },
    });
    return toAssetDto(asset);
  }

  async update(userId: string, id: string, manifest: AssetManifest): Promise<AssetDto> {
    const asset = await this.writable(userId, id);
    if (KIND_TO_DB[manifest.kind] !== asset.kind) {
      throw new BadRequestException('에셋 종류는 바꿀 수 없습니다.');
    }
    const updated = await this.prisma.asset.update({
      where: { id },
      data: { name: manifest.name, manifest: manifest as unknown as Prisma.InputJsonValue },
    });
    return toAssetDto(updated);
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.writable(userId, id);
    await this.prisma.asset.delete({ where: { id } });
  }

  private async find(id: string): Promise<Asset> {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException('에셋을 찾을 수 없습니다.');
    return asset;
  }

  private async readable(userId: string, id: string): Promise<Asset> {
    const asset = await this.find(id);
    if (asset.communityId) {
      await this.access.getMembership(userId, asset.communityId).catch(() => {
        throw new NotFoundException('에셋을 찾을 수 없습니다.');
      });
    }
    return asset;
  }

  private async writable(userId: string, id: string): Promise<Asset> {
    const asset = await this.readable(userId, id);
    if (asset.communityId) {
      await this.access.requireManager(userId, asset.communityId, '에셋 고치기');
    } else if (asset.creatorId !== userId) {
      throw new ForbiddenException('직접 만든 캐릭터만 고칠 수 있습니다.');
    }
    return asset;
  }
}
