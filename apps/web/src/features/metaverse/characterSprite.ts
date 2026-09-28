import {
  type AssetAnimation,
  type AssetManifest,
  type CharacterChoice,
  type Direction,
  characterKey,
  characterPalette,
  defaultCharacter,
} from '@metacode/shared';
import type Phaser from 'phaser';
import { frameAt, frameOnce } from '../assets/render';
import { type AssetLookup, ensureAssetTexture } from './mapView';

/** 캐릭터 한 명의 겉모습: 색을 바꾼 텍스처와 매니페스트(애니메이션) */
export interface CharacterLook {
  key: string;
  manifest: AssetManifest;
}

/**
 * 고른 캐릭터를 텍스처로 만든다. 같은 캐릭터·같은 색이면 텍스처를 함께 쓴다.
 * 에셋을 찾지 못하면(지워진 캐릭터 등) 사용자 ID로 고른 기본 캐릭터를 쓴다.
 */
export function characterLook(
  scene: Phaser.Scene,
  userId: string,
  choice: CharacterChoice | null,
  assetOf: AssetLookup,
): CharacterLook {
  let picked = choice ?? defaultCharacter(userId);
  let manifest = assetOf(picked.asset);
  if (!manifest || manifest.kind !== 'character') {
    picked = defaultCharacter(userId);
    manifest = assetOf(picked.asset)!;
  }
  const key = `char:${characterKey(picked)}`;
  ensureAssetTexture(scene, key, manifest, characterPalette(manifest, picked.colors));
  return { key, manifest };
}

/** 첨부 모션 한 번의 길이 */
export function emoteDurationMs(manifest: AssetManifest): number {
  const emote = manifest.animations.emote;
  return emote ? emote.frames.length * emote.frameMs : 0;
}

export interface CharacterState {
  dir: Direction;
  walking: boolean;
  /** 첨부 모션이 끝나는 시각. 지났으면 모션 중이 아님 */
  emoteUntil: number;
}

/** 지금 틀어야 할 애니메이션 이름 */
export function animationName(state: CharacterState, now: number): string {
  if (state.emoteUntil > now) return 'emote';
  return `${state.walking ? 'walk' : 'idle'}-${state.dir}`;
}

/** 애니메이션을 시작한 뒤 elapsedMs가 지났을 때의 프레임. 첨부 모션은 한 번만 재생한다 */
export function characterFrame(
  manifest: AssetManifest,
  name: string,
  dir: Direction,
  elapsedMs: number,
): number {
  const animation: AssetAnimation | undefined =
    manifest.animations[name] ?? manifest.animations[`idle-${dir}`];
  if (!animation) return 0;
  return name === 'emote' ? frameOnce(animation, elapsedMs) : frameAt(animation, elapsedMs);
}
