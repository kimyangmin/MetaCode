import { type AssetManifest, type ProfileCharacter, characterWorldSize } from '@metacode/shared';
import { type AssetLookup, type CharacterLook, resolveCharacterLook } from '@metacode/client';
import type Phaser from 'phaser';
import { ensureAssetTexture } from './mapView';

export type { CharacterLook } from '@metacode/client';

/**
 * 캐릭터 텍스처의 가장 긴 변. 광장에서 캐릭터는 세로 2타일(32px)이라 6배로 키워도 192px이므로,
 * 이보다 큰 그림은 텍스처로 올릴 때 줄여 담는다 (예전 최대 해상도 128×256과 같은 크기).
 */
const CHARACTER_TEXTURE_MAX = 256;

/**
 * 고른 캐릭터를 텍스처로 만든다. 같은 캐릭터·같은 색이면 텍스처를 함께 쓴다.
 * 에셋을 찾지 못하면(아직 받지 못했거나 지워진 캐릭터) 사용자 ID로 고른 기본 캐릭터를 쓴다.
 */
export function characterLook(
  scene: Phaser.Scene,
  userId: string,
  choice: ProfileCharacter | null,
  assetOf: AssetLookup,
): CharacterLook {
  const look = resolveCharacterLook(userId, choice, assetOf);
  ensureAssetTexture(scene, look.key, look.manifest, look.palette, CHARACTER_TEXTURE_MAX);
  return look;
}

/**
 * 캐릭터를 월드 크기(기본 1타일×2타일, 만든 사람이 정한 광장 크기)로 맞춘다. 매니페스트 해상도는
 * 16×16부터 512×512까지 제각각이라 텍스처 크기 그대로 그리면 캐릭터마다 크기가 달라진다. 텍스처를 바꾼
 * 뒤에도 다시 불러야 한다 (setTexture는 배율을 그대로 두므로 원본 크기가 달라지면 화면 크기도 달라진다).
 */
export function fitCharacter<T extends Phaser.GameObjects.Image>(
  sprite: T,
  manifest: Pick<AssetManifest, 'plazaHeight'>,
): T {
  const size = characterWorldSize(sprite.frame.width, sprite.frame.height, manifest.plazaHeight);
  return sprite.setDisplaySize(size.width, size.height) as T;
}

// 어떤 프레임을 보일지는 네이티브 앱과 함께 쓴다 (packages/client)
export {
  ATTACHMENT_HOP_MS,
  type CharacterPose,
  type CharacterState,
  type PlayingMotion,
  airbornePose,
  animationName,
  animatorCycleMs,
  animatorPose,
  characterPose,
  emoteDurationMs,
  motionDurationMs,
} from '@metacode/client';
