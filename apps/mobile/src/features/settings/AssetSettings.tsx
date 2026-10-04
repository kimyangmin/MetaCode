import { useMyAssets } from '../../api/assets';
import { AssetList } from '../editor/AssetList';

/** 설정 → 에셋 (웹 AssetSettings): 내가 그린 캐릭터. 새로 그리거나 내장 캐릭터를 복제해서 시작한다 */
export function AssetSettings() {
  const assets = useMyAssets().data ?? [];
  return (
    <AssetList
      assets={assets}
      kinds={['character']}
      communityId={null}
      emptyText="아직 그린 캐릭터가 없습니다. 새로 그리거나 내장 캐릭터를 복제해서 시작해 보세요."
    />
  );
}
