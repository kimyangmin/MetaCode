import { builtinAsset } from '@metacode/shared/builtin-assets';
import { describe, expect, it } from 'vitest';
import { PlazaStyle } from '@metacode/shared';
import { airbornePose, animationName, characterPose, emoteDurationMs } from './characterSprite';

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
    expect(characterPose(manifest, 'walk-down', 'down', 0).frame).toBe(walk.frames[0]);
    expect(characterPose(manifest, 'walk-down', 'down', cycle).frame).toBe(walk.frames[0]);

    const emote = manifest.animations.emote!;
    expect(emoteDurationMs(manifest)).toBe(emote.frames.length * emote.frameMs);
    expect(characterPose(manifest, 'emote', 'down', 60_000).frame).toBe(emote.frames.at(-1));
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
    expect(characterPose(manifest, 'dance', 'right', 0).frame).toBe(
      manifest.animations['idle-right']!.frames[0],
    );
  });

  it('횡스크롤용 캐릭터는 왼쪽이 없으면 오른쪽을 뒤집고, 위·아래는 오른쪽, 모션은 보는 쪽으로 뒤집는다', () => {
    const right = Object.fromEntries(
      Object.entries(manifest.animations).filter(([name]) => !/-(left|up|down)$/.test(name)),
    );
    const side = { ...manifest, style: PlazaStyle.SideScroll, animations: right };
    const walk = right['walk-right']!;
    expect(characterPose(side, 'walk-left', 'left', 0)).toEqual({
      frame: walk.frames[0],
      flip: true,
    });
    expect(characterPose(side, 'idle-down', 'down', 0)).toEqual({
      frame: right['idle-right']!.frames[0],
      flip: false,
    });
    expect(characterPose(side, 'emote', 'left', 0).flip).toBe(true);
    expect(characterPose(side, 'emote', 'right', 0).flip).toBe(false);
    expect(airbornePose(side, 'left', 0)).toEqual({ frame: walk.frames[1], flip: true });
    // 탑다운용(왼쪽을 그림)은 뒤집지 않는다
    expect(characterPose(manifest, 'walk-left', 'left', 0).flip).toBe(false);
    expect(characterPose(manifest, 'emote', 'left', 0).flip).toBe(false);
  });
});
