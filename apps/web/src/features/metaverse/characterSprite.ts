import {
  type AssetAnimation,
  type AssetManifest,
  CHARACTER_WORLD_HEIGHT,
  CHARACTER_WORLD_WIDTH,
  type Direction,
  type ProfileCharacter,
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
 * 에셋을 찾지 못하면(아직 받지 못했거나 지워진 캐릭터) 사용자 ID로 고른 기본 캐릭터를 쓴다.
 */
export function characterLook(
  scene: Phaser.Scene,
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
  // 직접 그린 캐릭터는 고칠 때마다 version이 바뀌므로 텍스처도 새로 만든다.
  const key = `char:${picked.version ?? ''}:${characterKey(picked)}`;
  ensureAssetTexture(scene, key, manifest, characterPalette(manifest, picked.colors));
  return { key, manifest };
}

/**
 * 캐릭터를 월드 크기(1타일×2타일)로 맞춘다. 매니페스트 해상도는 16×32부터 128×256까지 제각각이라
 * 텍스처 크기 그대로 그리면 캐릭터마다 크기가 달라진다. 텍스처를 바꾼 뒤에도 다시 불러야 한다
 * (setTexture는 배율을 그대로 두므로 원본 크기가 달라지면 화면 크기도 달라진다).
 */
export function fitCharacter<T extends Phaser.GameObjects.Image>(sprite: T): T {
  return sprite.setDisplaySize(CHARACTER_WORLD_WIDTH, CHARACTER_WORLD_HEIGHT) as T;
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
