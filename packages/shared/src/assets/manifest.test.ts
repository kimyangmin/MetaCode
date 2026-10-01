import { describe, expect, it } from 'vitest';
import { PlazaStyle } from '../domain/plaza.js';
import { BUILTIN_ASSETS, builtinAsset } from './builtin.js';
import {
  type AssetManifest,
  PALETTE_MAX_COLORS,
  assetManifestSchema,
  assetRefSchema,
  characterAnimation,
  characterFitsStyle,
  characterMotions,
  characterStyle,
  characterWorldSize,
  footprintCells,
  missingAnimations,
} from './manifest.js';
import { defaultAnimator } from './animator.js';
import { colorRamp, decodePixels, encodePixels } from './pixels.js';

const tile = (overrides: Partial<AssetManifest> = {}): AssetManifest => ({
  kind: 'tile',
  name: '테스트',
  width: 16,
  height: 16,
  palette: ['#112233'],
  frames: [encodePixels(new Uint8Array(256).fill(1))],
  animations: { default: { frames: [0], frameMs: 1000 } },
  ...overrides,
});

const problemsOf = (manifest: AssetManifest) => {
  const result = assetManifestSchema.safeParse(manifest);
  return result.success ? [] : result.error.issues.map((i) => i.message);
};

describe('픽셀 인코딩', () => {
  it('base64로 왕복한다', () => {
    const pixels = Uint8Array.from([0, 1, 2, 255, 64]);
    expect(decodePixels(encodePixels(pixels))).toEqual(pixels);
  });

  it('base64가 아니면 null', () => {
    expect(decodePixels('!!!')).toBeNull();
  });

  it('colorRamp는 밝은 면, 그림자, 외곽선 순으로 어두워진다', () => {
    const [light, shade, outline] = colorRamp('#E84537');
    expect(light).toBe('#e84537');
    const sum = (hex: string) =>
      [1, 3, 5].reduce((s, i) => s + parseInt(hex.slice(i, i + 2), 16), 0);
    expect(sum(shade)).toBeLessThan(sum(light));
    expect(sum(outline)).toBeLessThan(sum(shade));
  });
});

describe('내장 에셋', () => {
  it('모두 매니페스트 검증을 통과한다', () => {
    for (const [ref, manifest] of Object.entries(BUILTIN_ASSETS)) {
      expect(assetRefSchema.safeParse(ref).success, ref).toBe(true);
      expect(problemsOf(manifest), ref).toEqual([]);
    }
  });

  it('분수, 모닥불, 기본 캐릭터가 있다', () => {
    expect(builtinAsset('builtin:fountain')?.kind).toBe('object');
    expect(builtinAsset('builtin:campfire')?.animations.default!.frames.length).toBeGreaterThan(1);
    expect(builtinAsset('builtin:char-short')?.kind).toBe('character');
    expect(builtinAsset('builtin:char-long')?.colorSlots?.shirt).toHaveLength(3);
    expect(builtinAsset('builtin:없음')).toBeUndefined();
    expect(builtinAsset('toString')).toBeUndefined();
  });
});

describe('매니페스트 검증', () => {
  it('타일 크기가 16×16이 아니면 거절한다', () => {
    expect(problemsOf(tile({ width: 32 }))).toContain('타일은 16×16px이어야 합니다.');
  });

  it('프레임 크기가 맞지 않거나 팔레트에 없는 색을 쓰면 거절한다', () => {
    expect(problemsOf(tile({ frames: [encodePixels(new Uint8Array(10))] }))).toContain(
      '1번 프레임의 크기가 맞지 않습니다.',
    );
    expect(problemsOf(tile({ frames: [encodePixels(new Uint8Array(256).fill(2))] }))).toContain(
      '1번 프레임에 팔레트에 없는 색이 있습니다.',
    );
  });

  it('팔레트는 255색까지 (픽셀 값 255 = 마지막 색)', () => {
    const palette = (n: number) =>
      Array.from({ length: n }, (_, i) => `#${i.toString(16).padStart(6, '0')}`);
    const last = [encodePixels(new Uint8Array(256).fill(PALETTE_MAX_COLORS))];
    expect(PALETTE_MAX_COLORS).toBe(255);
    expect(problemsOf(tile({ palette: palette(255), frames: last }))).toEqual([]);
    expect(problemsOf(tile({ palette: palette(256), frames: last }))).not.toEqual([]);
  });

  it('없는 프레임을 가리키는 애니메이션을 거절한다', () => {
    expect(problemsOf(tile({ animations: { default: { frames: [3], frameMs: 100 } } }))).toContain(
      'default 애니메이션이 없는 프레임을 가리킵니다.',
    );
  });

  it('오브젝트는 크기에 맞는 footprint가 있어야 한다', () => {
    const object = tile({
      kind: 'object',
      width: 32,
      height: 16,
      frames: [encodePixels(new Uint8Array(512).fill(1))],
    });
    expect(problemsOf({ ...object, footprint: [1, 1] })).toEqual([]);
    expect(problemsOf({ ...object, footprint: [1] })).toContain(
      '오브젝트의 막힌 칸(footprint) 크기가 맞지 않습니다.',
    );
    expect(problemsOf({ ...object, width: 80, footprint: [1] })[0]).toMatch(/최대 64px/);
  });
});

describe('캐릭터 해상도', () => {
  const base = builtinAsset('builtin:char-short')!;

  /** 내장 캐릭터(16×32)를 nearest로 n배 키운 매니페스트 */
  const upscaled = (n: number): AssetManifest => {
    const width = base.width * n;
    const height = base.height * n;
    return {
      ...base,
      width,
      height,
      frames: base.frames.map((frame) => {
        const pixels = decodePixels(frame)!;
        const next = new Uint8Array(width * height);
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            next[y * width + x] = pixels[Math.floor(y / n) * base.width + Math.floor(x / n)] ?? 0;
          }
        }
        return encodePixels(next);
      }),
    };
  };

  it('가로·세로 각각 16~512px면 비율과 상관없이 받는다', () => {
    expect(problemsOf(upscaled(2))).toEqual([]);
    expect(problemsOf(upscaled(3))).toEqual([]);
    const square = encodePixels(new Uint8Array(64 * 64).fill(1));
    const squareFrames = { ...base, width: 64, height: 64, frames: base.frames.map(() => square) };
    expect(problemsOf(squareFrames)).toEqual([]);
  });

  it('범위를 벗어나거나 세로 비율이 다르면 거절한다', () => {
    const message = '캐릭터 해상도는 가로·세로 16~512px이어야 합니다.';
    expect(problemsOf({ ...base, width: 8, height: 16 })).toContain(message);
    expect(problemsOf({ ...base, width: 512, height: 1024 })).toContain(message);
    expect(problemsOf({ ...base, width: 32, height: 8 })).toContain(message);
  });

  it('해상도 × 프레임 수가 너무 많으면 거절한다', () => {
    // 가장 큰 해상도(512×512)는 32프레임까지다 (ASSET_PIXEL_BUDGET). 16×32를 16배 키우면 256×512라
    // 가로를 512로 넓힌다.
    const tall = upscaled(16);
    const widen = (frame: string) => {
      const pixels = decodePixels(frame)!;
      const next = new Uint8Array(512 * 512);
      for (let y = 0; y < 512; y++)
        next.set(pixels.subarray(y * 256, y * 256 + 256), y * 512 + 128);
      return encodePixels(next);
    };
    const big = { ...tall, width: 512, height: 512, frames: tall.frames.map(widen) };
    expect(problemsOf(big)).toEqual([]);
    const spare = encodePixels(new Uint8Array(big.width * big.height));
    const tooMany = {
      ...big,
      frames: [...big.frames, ...Array<string>(33 - big.frames.length).fill(spare)],
    };
    expect(tooMany.frames.length).toBe(33);
    expect(problemsOf(tooMany)[0]).toMatch(/에셋이 너무 큽니다/);
  });
});

describe('캐릭터 필수 애니메이션', () => {
  const base = builtinAsset('builtin:char-short')!;

  it('내장 캐릭터는 빠진 것이 없다', () => {
    expect(missingAnimations(base)).toEqual([]);
  });

  it('없거나 프레임이 모자라면 빠진 것으로 본다', () => {
    const animations = Object.fromEntries(
      Object.entries(base.animations).filter(([name]) => name !== 'walk-up'),
    );
    const shortWalk = { ...animations, 'walk-left': { frames: [0], frameMs: 100 } };
    const missing = missingAnimations({ ...base, animations: shortWalk }).map((a) => a.name);
    expect(missing).toEqual(['walk-left', 'walk-up']);
    expect(problemsOf({ ...base, animations: shortWalk })[0]).toMatch(/그리지 않은 애니메이션/);
  });

  it('빈 프레임을 쓰면 빠진 것으로 본다', () => {
    const frames = [...base.frames, encodePixels(new Uint8Array(16 * 32))];
    const blank = frames.length - 1;
    const manifest = {
      ...base,
      frames,
      animations: { ...base.animations, emote: { frames: [0, blank], frameMs: 100 } },
    };
    expect(missingAnimations(manifest).map((a) => a.name)).toEqual(['emote']);
  });
});

describe('캐릭터 광장 방식', () => {
  const base = builtinAsset('builtin:char-short')!;
  // 내장 캐릭터(탑다운용)에서 오른쪽만 남긴 횡스크롤용 캐릭터 (왼쪽은 좌우 반전으로 그림)
  const rightOnly = Object.fromEntries(
    Object.entries(base.animations).filter(([name]) => !/-(left|up|down)$/.test(name)),
  );
  const jump = { 'jump-right': base.animations['walk-right']! };

  it('방식이 없으면 탑다운이고, 횡스크롤용은 오른쪽 대기·걷기·점프와 첨부 모션만 필수다', () => {
    expect(characterStyle(base)).toBe(PlazaStyle.TopDown);
    const side = { ...base, style: PlazaStyle.SideScroll, animations: rightOnly };
    expect(missingAnimations(side).map((a) => a.name)).toEqual(['jump-right']);
    const complete = { ...side, animations: { ...rightOnly, ...jump } };
    expect(missingAnimations(complete)).toEqual([]);
    expect(problemsOf(complete)).toEqual([]);
    // 같은 그림이라도 탑다운이면 왼쪽·위·아래가 빠졌다
    expect(missingAnimations({ ...complete, style: undefined }).map((a) => a.name)).toEqual([
      'idle-down',
      'idle-left',
      'idle-up',
      'walk-down',
      'walk-left',
      'walk-up',
    ]);
  });

  it('왼쪽이 없으면 오른쪽을 뒤집어 쓰고, 위·아래가 없으면 오른쪽, 그린 것은 그대로', () => {
    const side = { animations: { ...rightOnly, ...jump } };
    expect(characterAnimation(side, 'walk-left')).toEqual({
      animation: rightOnly['walk-right'],
      mirrored: true,
    });
    expect(characterAnimation(side, 'idle-down')).toEqual({
      animation: rightOnly['idle-right'],
      mirrored: false,
    });
    expect(characterAnimation(base, 'walk-left')).toEqual({
      animation: base.animations['walk-left'],
      mirrored: false,
    });
    expect(characterAnimation(side, 'dance')).toBeUndefined();
  });

  it('횡스크롤용은 탑다운에서 쓸 수 없고, 탑다운용은 어디서나 쓴다', () => {
    const side = { style: PlazaStyle.SideScroll };
    expect(characterFitsStyle(side, PlazaStyle.SideScroll)).toBe(true);
    expect(characterFitsStyle(side, PlazaStyle.TopDown)).toBe(false);
    expect(characterFitsStyle(base, PlazaStyle.SideScroll)).toBe(true);
    expect(characterFitsStyle(base, PlazaStyle.TopDown)).toBe(true);
  });

  it('방식은 캐릭터만, 정해진 애니메이션에는 모션 키를 달 수 없다', () => {
    expect(problemsOf(tile({ style: PlazaStyle.SideScroll }))).toContain(
      '광장 방식(style)은 캐릭터만 쓸 수 있습니다.',
    );
    const keyed = {
      ...base,
      animations: {
        ...base.animations,
        'jump-left': { frames: [0], frameMs: 100, key: '1' as const },
      },
    };
    expect(problemsOf(keyed).join()).toMatch(/jump-left: 정해진 애니메이션/);
  });
});

describe('footprintCells', () => {
  it('놓은 칸(왼쪽 아래)을 기준으로 막힌 칸을 돌려준다', () => {
    // 2×3타일, 아래 줄 두 칸만 막힘
    const cells = footprintCells({ width: 32, height: 48, footprint: [0, 0, 0, 0, 1, 1] }, 10, 20);
    expect(cells).toEqual([
      { x: 10, y: 20 },
      { x: 11, y: 20 },
    ]);
    const top = footprintCells({ width: 16, height: 32, footprint: [1, 0] }, 3, 5);
    expect(top).toEqual([{ x: 3, y: 4 }]);
  });
});

describe('캐릭터 모션 (숫자 키)', () => {
  const base = builtinAsset('builtin:char-short')!;
  const withMotions = (animations: AssetManifest['animations']): AssetManifest => ({
    ...base,
    animations: { ...base.animations, ...animations },
  });
  const frame = base.animations['idle-down']!.frames[0]!;

  it('필수 애니메이션 밖의 애니메이션에 키를 달면 모션이고, 키 순서로 나온다', () => {
    const manifest = withMotions({
      'motion-2': { frames: [frame], frameMs: 150, key: '0', label: '인사' },
      'motion-1': { frames: [frame], frameMs: 150, key: '1', label: '춤', loop: true },
    });
    expect(problemsOf(manifest)).toEqual([]);
    expect(characterMotions(manifest)).toEqual([
      { name: 'motion-1', key: '1', label: '춤', loop: true },
      { name: 'motion-2', key: '0', label: '인사', loop: false },
    ]);
  });

  it('키가 겹치거나, 정해진 애니메이션에 달거나, 캐릭터가 아니면 거절한다', () => {
    expect(
      problemsOf(
        withMotions({
          a: { frames: [frame], frameMs: 150, key: '1' },
          b: { frames: [frame], frameMs: 150, key: '1' },
        }),
      ).join(' '),
    ).toContain('겹칩니다');
    expect(
      problemsOf(withMotions({ 'idle-down': { ...base.animations['idle-down']!, key: '2' } })).join(
        ' ',
      ),
    ).toContain('정해진 애니메이션');
    expect(
      problemsOf(tile({ animations: { default: { frames: [0], frameMs: 1000, key: '1' } } })),
    ).toContain('모션(키, 이름, 반복)은 캐릭터만 쓸 수 있습니다.');
  });
});

describe('RLE로 담은 프레임', () => {
  it('투명한 곳이 많은 큰 그림은 짧게 담고, 그대로 풀린다', () => {
    const pixels = new Uint8Array(512 * 1024);
    pixels.fill(3, 1000, 5000);
    pixels[7] = 1;
    const encoded = encodePixels(pixels);
    expect(encoded.startsWith('~')).toBe(true);
    // 그냥 base64(약 70만 글자)보다 훨씬 짧다
    expect(encoded.length).toBeLessThan(12_000);
    expect(decodePixels(encoded)).toEqual(pixels);
  });

  it('줄지 않는 그림은 그냥 base64이고, 그림 크기보다 크게 풀리면 null', () => {
    const noise = Uint8Array.from({ length: 300 }, (_, i) => (i * 7919) % 251);
    const encoded = encodePixels(noise);
    expect(encoded.startsWith('~')).toBe(false);
    expect(decodePixels(encoded)).toEqual(noise);
    expect(decodePixels(encodePixels(new Uint8Array(4096)), 100)).toBeNull();
  });
});

describe('빈 애니메이션과 횡스크롤 방향', () => {
  const base = builtinAsset('builtin:char-short')!;
  const blank = encodePixels(new Uint8Array(base.width * base.height));
  const frames = [...base.frames, blank];
  const blankIndex = frames.length - 1;
  const rightOnly = Object.fromEntries(
    Object.entries(base.animations).filter(([name]) => !/-(left|up|down)$/.test(name)),
  );
  // 탑다운으로 시작해 횡스크롤로 바꾸면 쓰지 않게 된 아래·위가 빈 채로 남는다
  const side: AssetManifest = {
    ...base,
    style: PlazaStyle.SideScroll,
    frames,
    animations: {
      ...rightOnly,
      'jump-right': base.animations['walk-right']!,
      'walk-down': { frames: [blankIndex, blankIndex], frameMs: 150 },
      'idle-down': { frames: [blankIndex], frameMs: 150 },
    },
  };

  it('빈 애니메이션은 없는 것으로 보고 오른쪽을 쓴다', () => {
    expect(characterAnimation(side, 'walk-down')).toEqual({
      animation: rightOnly['walk-right'],
      mirrored: false,
    });
    expect(characterAnimation(side, 'idle-down')?.animation).toBe(rightOnly['idle-right']);
  });

  it('횡스크롤용은 아래·위를 그렸어도 오른쪽을 먼저 쓴다', () => {
    const drawnDown = {
      ...side,
      animations: { ...side.animations, 'walk-down': base.animations['walk-down']! },
    };
    expect(characterAnimation(drawnDown, 'walk-down')?.animation).toBe(rightOnly['walk-right']);
    // 탑다운용은 그린 아래를 그대로 쓴다
    expect(characterAnimation(base, 'walk-down')?.animation).toBe(base.animations['walk-down']);
  });
});

describe('광장 크기', () => {
  const base = builtinAsset('builtin:char-short')!;

  it('세로 크기를 정하면 가로도 비율대로, 넓은 그림의 가로 한도도 함께 커진다', () => {
    expect(characterWorldSize(16, 32)).toEqual({ width: 16, height: 32 });
    expect(characterWorldSize(16, 32, 3)).toEqual({ width: 24, height: 48 });
    expect(characterWorldSize(512, 16, 1).width).toBe(32);
  });

  it('0.5타일 단위 1~4타일만, 캐릭터만 쓸 수 있다', () => {
    expect(problemsOf({ ...base, plazaHeight: 3.5 })).toEqual([]);
    expect(problemsOf({ ...base, plazaHeight: 2.2 }).join()).toMatch(/광장 크기는 1~4타일/);
    expect(problemsOf({ ...base, plazaHeight: 5 }).join()).toMatch(/광장 크기는 1~4타일/);
    expect(problemsOf(tile({ plazaHeight: 2 }))).toContain('광장 크기는 캐릭터만 쓸 수 있습니다.');
  });
});

describe('애니메이터가 있는 캐릭터', () => {
  const base = builtinAsset('builtin:char-short')!;
  const animator = {
    ...defaultAnimator(new Set(Object.keys(base.animations))),
    parameters: [
      { name: 'wave', type: 'trigger' as const, key: '2' as const, label: '인사' },
      { name: 'sit', type: 'bool' as const, key: '1' as const },
    ],
  };

  it('숫자 키가 달린 파라미터도 모션 목록에 나온다', () => {
    const manifest = { ...base, animator };
    expect(problemsOf(manifest)).toEqual([]);
    expect(characterMotions(manifest)).toEqual([
      { name: 'sit', key: '1', label: 'sit', loop: true, parameter: 'bool' },
      { name: 'wave', key: '2', label: '인사', loop: false, parameter: 'trigger' },
    ]);
  });

  it('파라미터 키가 모션 키와 겹치거나, 없는 애니메이션을 가리키면 거절한다', () => {
    const frame = base.animations['idle-down']!.frames[0]!;
    const clash = {
      ...base,
      animations: {
        ...base.animations,
        dance: { frames: [frame], frameMs: 100, key: '1' as const },
      },
      animator,
    };
    expect(problemsOf(clash).join()).toMatch(/모션 키 1가 겹칩니다/);
    const broken = {
      ...base,
      animator: {
        ...animator,
        states: [...animator.states, { name: 'fly', animation: 'fly', x: 0, y: 0 }],
      },
    };
    expect(problemsOf(broken).join()).toMatch(/애니메이션 fly이\(가\) 없습니다/);
    expect(problemsOf(tile({ animator })).join()).toMatch(/애니메이터는 캐릭터만/);
  });
});
