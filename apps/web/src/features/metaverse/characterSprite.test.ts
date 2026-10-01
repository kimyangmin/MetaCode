import { builtinAsset } from '@metacode/shared/builtin-assets';
import { describe, expect, it } from 'vitest';
import { animationName, characterFrame, emoteDurationMs } from './characterSprite';

const manifest = builtinAsset('builtin:char-long')!;

describe('캐릭터 애니메이션', () => {
  it('멈춰 있으면 대기, 움직이면 걷기, 첨부 모션 중이면 모션', () => {
    expect(animationName({ dir: 'left', walking: false, emoteUntil: 0 }, 1_000)).toBe('idle-left');
    expect(animationName({ dir: 'up', walking: true, emoteUntil: 0 }, 1_000)).toBe('walk-up');
    expect(animationName({ dir: 'up', walking: true, emoteUntil: 1_500 }, 1_000)).toBe('emote');
  });

  it('걷기는 되풀이하고, 첨부 모션은 한 번 틀고 마지막 프레임에 머문다', () => {
    const walk = manifest.animations['walk-down']!;
    const cycle = walk.frames.length * walk.frameMs;
    expect(characterFrame(manifest, 'walk-down', 'down', 0)).toBe(walk.frames[0]);
    expect(characterFrame(manifest, 'walk-down', 'down', cycle)).toBe(walk.frames[0]);

    const emote = manifest.animations.emote!;
    expect(emoteDurationMs(manifest)).toBe(emote.frames.length * emote.frameMs);
    expect(characterFrame(manifest, 'emote', 'down', 60_000)).toBe(emote.frames.at(-1));
  });

  it('캐릭터 모션은 첨부 모션 다음이고, 끝나는 시각이 지나면 대기·걷기로 돌아간다', () => {
    const motion = { name: 'motion-1', loop: false, until: 1_500 };
    expect(animationName({ dir: 'down', walking: false, emoteUntil: 0, motion }, 1_000)).toBe(
      'motion-1',
    );
    expect(animationName({ dir: 'down', walking: false, emoteUntil: 0, motion }, 2_000)).toBe(
      'idle-down',
    );
    expect(animationName({ dir: 'down', walking: false, emoteUntil: 1_200, motion }, 1_000)).toBe(
      'emote',
    );
  });

  it('애니메이션이 없으면 그 방향의 대기 프레임', () => {
    expect(characterFrame(manifest, 'dance', 'right', 0)).toBe(
      manifest.animations['idle-right']!.frames[0],
    );
  });
});
