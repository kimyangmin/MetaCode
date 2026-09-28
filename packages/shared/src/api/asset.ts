import { z } from 'zod';
import { type AssetKind, type AssetManifest, assetManifestSchema } from '../assets/manifest.js';

/** 한 사람이 만들 수 있는 캐릭터 수 */
export const CHARACTER_ASSET_LIMIT = 20;
/** 커뮤니티 하나의 타일·오브젝트 수 */
export const COMMUNITY_ASSET_LIMIT = 200;

/** 도트 에디터로 만든 에셋 */
export interface AssetDto {
  id: string;
  kind: AssetKind;
  name: string;
  /** 타일·오브젝트가 속한 커뮤니티. 캐릭터는 null (만든 사람의 것) */
  communityId: string | null;
  creatorId: string;
  manifest: AssetManifest;
  /** 바뀔 때마다 달라진다 (광장이 텍스처를 다시 만드는 기준) */
  updatedAt: string;
}

/** 캐릭터는 communityId 없이, 타일·오브젝트는 그 커뮤니티에 만든다 */
export const createAssetSchema = z.object({
  communityId: z.uuid().nullable().default(null),
  manifest: assetManifestSchema,
});
export type CreateAssetRequest = z.input<typeof createAssetSchema>;

/** 종류(kind)는 바꿀 수 없다 */
export const updateAssetSchema = z.object({ manifest: assetManifestSchema });
export type UpdateAssetRequest = z.input<typeof updateAssetSchema>;

/** 목록: communityId가 있으면 그 커뮤니티의 타일·오브젝트, 없으면 내 캐릭터 */
export const listAssetsQuerySchema = z.object({ communityId: z.uuid().optional() });
