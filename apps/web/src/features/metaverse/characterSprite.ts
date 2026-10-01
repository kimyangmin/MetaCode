import {
  type AssetAnimation,
  type AssetManifest,
  type Direction,
  type ProfileCharacter,
  characterKey,
  characterWorldSize,
  characterPalette,
  defaultCharacter,
} from '@metacode/shared';
import type Phaser from 'phaser';
import { frameAt, frameOnce } from '../assets/render';
import { type AssetLookup, ensureAssetTexture, manifestId } from './mapView';

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
  // 텍스처 키는 실제로 그린 매니페스트 기준이다. user:updated가 먼저 오고 고친 에셋은 나중에 받으므로,
  // version으로 키를 만들면 새 버전 키에 예전 그림이 들어가 받은 뒤에도 바뀌지 않았다.
  const key = `char:${manifestId(manifest)}:${characterKey(picked)}`;
  ensureAssetTexture(scene, key, manifest, characterPalette(manifest, picked.colors));
  return { key, manifest };
}

/**
 * 캐릭터를 월드 크기(1타일×2타일)로 맞춘다. 매니페스트 해상도는 16×16부터 512×512까지 제각각이라
 * 텍스처 크기 그대로 그리면 캐릭터마다 크기가 달라진다. 텍스처를 바꾼 뒤에도 다시 불러야 한다
 * (setTexture는 배율을 그대로 두므로 원본 크기가 달라지면 화면 크기도 달라진다).
 */
export function fitCharacter<T extends Phaser.GameObjects.Image>(sprite: T): T {
  const size = characterWorldSize(sprite.frame.width, sprite.frame.height);
  return sprite.setDisplaySize(size.width, size.height) as T;
}

/** 첨부 모션 한 번의 길이 */
export function emoteDurationMs(manifest: AssetManifest): number {
  const emote = manifest.animations.emote;
  return emote ? emote.frames.length * emote.frameMs : 0;
}

/** 틀고 있는 캐릭터 모션 (숫자 키). 한 번 트는 모션은 until이 끝나는 시각, 반복은 Infinity */
export interface PlayingMotion {
  name: string;
  loop: boolean;
  until: number;
}

export interface CharacterState {
  dir: Direction;
  walking: boolean;
  /** 첨부 모션이 끝나는 시각. 지났으면 모션 중이 아님 */
  emoteUntil: number;
  /** 캐릭터 모션. 움직이면 멈추므로 걷는 중에는 없다 */
  motion?: PlayingMotion | null;
}

/** 지금 틀어야 할 애니메이션 이름: 첨부 모션 > 캐릭터 모션 > 걷기·대기 */
export function animationName(state: CharacterState, now: number): string {
  if (state.emoteUntil > now) return 'emote';
  if (state.motion && state.motion.until > now) return state.motion.name;
  return `${state.walking ? 'walk' : 'idle'}-${state.dir}`;
}

/** 한 번 트는 모션의 길이 */
export function motionDurationMs(manifest: AssetManifest, name: string): number {
  const animation = manifest.animations[name];
  return animation ? animation.frames.length * animation.frameMs : 0;
}

/**
 * 횡스크롤에서 공중에 있을 때(점프, 떨어지기)의 프레임: jump-<방향> 애니메이션이 있으면 그것을 한 번,
 * 없으면 걷기의 두 번째 프레임(다리를 벌린 모습)에 멈춘다.
 */
export function airborneFrame(manifest: AssetManifest, dir: Direction, elapsedMs: number): number {
  const jump = manifest.animations[`jump-${dir}`];
  if (jump) return frameOnce(jump, elapsedMs);
  const walk = manifest.animations[`walk-${dir}`] ?? manifest.animations[`idle-${dir}`];
  if (!walk) return 0;
  return walk.frames[Math.min(1, walk.frames.length - 1)]!;
}

/**
 * 애니메이션을 시작한 뒤 elapsedMs가 지났을 때의 프레임. 첨부 모션과 once(한 번 트는 캐릭터 모션)는
 * 한 번만 재생하고 마지막 프레임에 머문다. 없는 애니메이션이면 그 방향의 대기 프레임.
 */
export function characterFrame(
  manifest: AssetManifest,
  name: string,
  dir: Direction,
  elapsedMs: number,
  once = name === 'emote',
): number {
  const animation: AssetAnimation | undefined =
    manifest.animations[name] ?? manifest.animations[`idle-${dir}`];
  if (!animation) return 0;
  return once ? frameOnce(animation, elapsedMs) : frameAt(animation, elapsedMs);
}
