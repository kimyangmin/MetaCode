import {
  type AssetDto,
  type UserProfile,
  characterPalette,
  defaultCharacter,
  isBuiltinRef,
} from '@metacode/shared';
import { BUILTIN_ASSETS } from '@metacode/shared/builtin-assets';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../api/client';
import { AssetPreview } from '../assets/AssetPreview';

/** 정보 팝업의 캐릭터 무대에서 캐릭터가 차지할 크기 (가장 긴 변, px) */
const CHARACTER_BOX = 72;

/**
 * 사용자 정보 팝업의 캐릭터: 그 사람이 광장에서 쓰는 캐릭터(고른 색 그대로)가 걷는 모습.
 * 내장 에셋(약 150KB)을 쓰므로 팝업이 열릴 때 따로 불러온다 (ProfilePopup의 lazy).
 * 직접 그린 캐릭터는 광장과 같은 캐시(['assets','one',id,version])로 받고, 받기 전에는 기본 캐릭터를 보여 준다.
 */
export default function ProfileCharacter({ user }: { user: UserProfile }) {
  const fallback = defaultCharacter(user.id);
  const choice = user.character ?? fallback;
  const builtin = isBuiltinRef(choice.asset) ? BUILTIN_ASSETS[choice.asset] : undefined;
  const custom = useQuery({
    queryKey: ['assets', 'one', choice.asset, user.character?.version ?? ''],
    queryFn: () => apiFetch<AssetDto>(`/assets/${choice.asset}`),
    enabled: !builtin,
    staleTime: Infinity,
  });
  const loaded = builtin ?? custom.data?.manifest;
  // 받기 전(또는 지워진 에셋)이면 사용자 ID로 고른 기본 캐릭터
  const manifest = loaded ?? BUILTIN_ASSETS[fallback.asset]!;
  const colors = loaded ? choice.colors : fallback.colors;

  return (
    <AssetPreview
      manifest={manifest}
      box={CHARACTER_BOX}
      animation="walk-down"
      palette={characterPalette(manifest, colors)}
    />
  );
}
