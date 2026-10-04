import {
  type AssetAnimation,
  type AssetManifest,
  type AnimatorState,
  type Direction,
  PlazaStyle,
  animatorClip,
  animatorStateSpeed,
  characterAnimation,
  characterStyle,
} from '@metacode/shared';
import { frameAt, frameOnce } from '../assets/frames.js';

/*
 * 캐릭터가 지금 어떤 애니메이션의 몇 번째 프레임을 보일지 (그리는 쪽과 상관없는 규칙).
 * 웹(Phaser)과 네이티브 앱(Skia)이 같은 규칙으로 그린다.
 */

/** 첨부 모션이 없는(또는 비어 있는) 캐릭터가 첨부 메시지를 보냈을 때 제자리에서 뛰는 시간 */
export const ATTACHMENT_HOP_MS = 600;

/**
 * 첨부 모션 한 번의 길이. 첨부 모션은 필수가 아니라서, 없거나 모든 프레임이 비었으면 0이다
 * (그때 광장은 애니메이션 대신 ATTACHMENT_HOP_MS 동안 제자리에서 뛴다).
 */
export function emoteDurationMs(manifest: AssetManifest): number {
  const emote = characterAnimation(manifest, 'emote')?.animation;
  return emote ? emote.frames.length * emote.frameMs : 0;
}

/** 틀고 있는 캐릭터 모션 (키). 한 번 트는 모션은 until이 끝나는 시각, 반복은 Infinity */
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

/** 그릴 프레임과 좌우 반전 여부 */
export interface CharacterPose {
  frame: number;
  flip: boolean;
}

/**
 * 방향이 없는 애니메이션(첨부 모션, 캐릭터 모션)을 왼쪽을 볼 때 뒤집을지. 횡스크롤용 캐릭터는 오른쪽을 보고
 * 그리므로 왼쪽을 보면 뒤집고, 탑다운용은 앞을 보고 그리므로 그대로 둔다.
 */
function facesLeft(manifest: AssetManifest, dir: Direction): boolean {
  return dir === 'left' && characterStyle(manifest) === PlazaStyle.SideScroll;
}

/**
 * 횡스크롤에서 공중에 있을 때(점프, 떨어지기)의 모습: jump-<방향> 애니메이션이 있으면 그것을 한 번,
 * 없으면 걷기의 두 번째 프레임(다리를 벌린 모습)에 멈춘다. 왼쪽이 없으면 오른쪽을 뒤집는다.
 */
export function airbornePose(
  manifest: AssetManifest,
  dir: Direction,
  elapsedMs: number,
): CharacterPose {
  const jump = characterAnimation(manifest, `jump-${dir}`);
  if (jump) return { frame: frameOnce(jump.animation, elapsedMs), flip: jump.mirrored };
  const walk =
    characterAnimation(manifest, `walk-${dir}`) ?? characterAnimation(manifest, `idle-${dir}`);
  if (!walk) return { frame: 0, flip: false };
  const { frames } = walk.animation;
  return { frame: frames[Math.min(1, frames.length - 1)]!, flip: walk.mirrored };
}

/** 애니메이터 상태의 애니메이션이 한 번 도는 시간 ("끝나면 넘어가기"에 쓴다). 없으면 0 */
export function animatorCycleMs(
  manifest: AssetManifest,
  state: AnimatorState,
  dir: Direction,
): number {
  const clip = animatorClip(manifest, state.animation, dir);
  return clip ? clip.animation.frames.length * clip.animation.frameMs : 0;
}

/**
 * 애니메이터 상태의 모습. 방향이 붙은 애니메이션은 보는 방향의 것(횡스크롤용 왼쪽은 오른쪽 반전),
 * 방향 없이 그린 것은 첨부 모션처럼 횡스크롤용이 왼쪽을 볼 때 뒤집는다. 반복하지 않는 상태는 한 번 틀고
 * 마지막 프레임에 머문다.
 */
export function animatorPose(
  manifest: AssetManifest,
  state: AnimatorState,
  dir: Direction,
  elapsedMs: number,
): CharacterPose {
  const clip = animatorClip(manifest, state.animation, dir);
  if (!clip) return characterPose(manifest, `idle-${dir}`, dir, 0);
  const once = state.loop === false;
  // 상태의 재생 속도 (stepAnimator도 같은 속도로 "끝나면"을 잰다)
  const played = elapsedMs * animatorStateSpeed(state);
  const frame = once ? frameOnce(clip.animation, played) : frameAt(clip.animation, played);
  return { frame, flip: clip.directional ? clip.mirrored : facesLeft(manifest, dir) };
}

/**
 * 애니메이션을 시작한 뒤 elapsedMs가 지났을 때의 모습. 첨부 모션과 once(한 번 트는 캐릭터 모션)는
 * 한 번만 재생하고 마지막 프레임에 머문다. 없는 애니메이션이면 그 방향의 대기.
 * 횡스크롤용 캐릭터는 왼쪽이 없으면 오른쪽을 뒤집고, 위·아래가 없으면 오른쪽 (characterAnimation).
 */
export function characterPose(
  manifest: AssetManifest,
  name: string,
  dir: Direction,
  elapsedMs: number,
  once = name === 'emote',
): CharacterPose {
  const own = manifest.animations[name];
  if (own && !/-(down|left|right|up)$/.test(name)) {
    // 방향이 없는 애니메이션: 첨부 모션, 캐릭터 모션
    const frame = once ? frameOnce(own, elapsedMs) : frameAt(own, elapsedMs);
    return { frame, flip: facesLeft(manifest, dir) };
  }
  const found = characterAnimation(manifest, name) ?? characterAnimation(manifest, `idle-${dir}`);
  if (!found) return { frame: 0, flip: false };
  const animation: AssetAnimation = found.animation;
  const frame = once ? frameOnce(animation, elapsedMs) : frameAt(animation, elapsedMs);
  return { frame, flip: found.mirrored };
}
