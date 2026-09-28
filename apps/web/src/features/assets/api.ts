import type { AssetDto, AssetManifest } from '@metacode/shared';
import { type QueryClient, useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../api/client';
import { jsonBody } from '../../api/queries';

export const assetKeys = {
  mine: ['assets', 'mine'] as const,
  community: (communityId: string) => ['assets', 'community', communityId] as const,
  one: (id: string) => ['assets', 'one', id] as const,
};

/** 내가 그린 캐릭터 */
export const useMyAssets = () =>
  useQuery({ queryKey: assetKeys.mine, queryFn: () => apiFetch<AssetDto[]>('/assets') });

/** 커뮤니티의 타일·오브젝트 */
export const useCommunityAssets = (communityId: string) =>
  useQuery({
    queryKey: assetKeys.community(communityId),
    queryFn: () => apiFetch<AssetDto[]>(`/assets?communityId=${communityId}`),
  });

/** 새로 만들면 id 없이, 고치면 id와 함께 저장한다 */
export async function saveAsset(
  queryClient: QueryClient,
  target: { id?: string; communityId: string | null },
  manifest: AssetManifest,
): Promise<AssetDto> {
  const asset = target.id
    ? await apiFetch<AssetDto>(`/assets/${target.id}`, {
        method: 'PUT',
        ...jsonBody({ manifest }),
      })
    : await apiFetch<AssetDto>('/assets', {
        method: 'POST',
        ...jsonBody({ communityId: target.communityId, manifest }),
      });
  queryClient.setQueryData(assetKeys.one(asset.id), asset);
  await invalidateLists(queryClient, asset);
  return asset;
}

export async function deleteAsset(queryClient: QueryClient, asset: AssetDto): Promise<void> {
  await apiFetch(`/assets/${asset.id}`, { method: 'DELETE' });
  queryClient.removeQueries({ queryKey: assetKeys.one(asset.id) });
  await invalidateLists(queryClient, asset);
}

function invalidateLists(queryClient: QueryClient, asset: AssetDto) {
  return queryClient.invalidateQueries({
    queryKey: asset.communityId ? assetKeys.community(asset.communityId) : assetKeys.mine,
  });
}
