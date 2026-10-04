import {
  type AssetManifest,
  type AssetRef,
  type ProfileCharacter,
  characterKey,
  characterPalette,
  defaultCharacter,
} from '@metacode/shared';

/** 에셋 참조 → 매니페스트 (내장 에셋 + 서버에서 받아 둔 에셋). 없으면 undefined */
export type AssetLookup = (ref: AssetRef) => AssetManifest | undefined;

/** 매니페스트마다 다른 번호 (같은 에셋을 고쳐 새 매니페스트를 받으면 그림을 새로 만든다) */
const manifestIds = new WeakMap<AssetManifest, number>();
let nextManifestId = 0;

/**
 * 매니페스트 객체마다 붙이는 번호. 그림(텍스처) 키에 넣으면 에셋을 고쳐 새 매니페스트를 받았을 때 키가 바뀌어
 * 새 그림으로 다시 만든다 (같은 에셋 ID·버전이라도 예전 매니페스트로 만든 그림을 쓰지 않게).
 */
export function manifestId(manifest: AssetManifest): number {
  let id = manifestIds.get(manifest);
  if (id === undefined) {
    id = ++nextManifestId;
    manifestIds.set(manifest, id);
  }
  return id;
}

/** 캐릭터 한 명의 겉모습: 그림 키(같으면 그림을 함께 씀), 매니페스트(애니메이션), 고른 색을 입힌 팔레트 */
export interface CharacterLook {
  key: string;
  manifest: AssetManifest;
  palette: readonly string[];
}

/**
 * 고른 캐릭터의 겉모습. 에셋을 찾지 못하면(아직 받지 못했거나 지워진 캐릭터) 사용자 ID로 고른 기본 캐릭터.
 * 키는 실제로 그린 매니페스트 기준이다: user:updated가 먼저 오고 고친 에셋은 나중에 받으므로, version으로
 * 키를 만들면 새 버전 키에 예전 그림이 들어가 받은 뒤에도 바뀌지 않았다.
 */
export function resolveCharacterLook(
  userId: string,
  choice: ProfileCharacter | null,
  assetOf: AssetLookup,
): CharacterLook {
  let picked: ProfileCharacter = choice ?? defaultCharacter(userId);
  let manifest = assetOf(picked.asset);
  if (!manifest || manifest.kind !== 'character') {
    picked = defaultCharacter(userId);
    manifest = assetOf(picked.asset)!;
  }
  return {
    key: `char:${manifestId(manifest)}:${characterKey(picked)}`,
    manifest,
    palette: characterPalette(manifest, picked.colors),
  };
}
