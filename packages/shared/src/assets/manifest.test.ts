import { describe, expect, it } from 'vitest';
import { BUILTIN_ASSETS, builtinAsset } from './builtin.js';
import {
  type AssetManifest,
  assetManifestSchema,
  assetRefSchema,
  characterMotions,
  footprintCells,
  missingAnimations,
} from './manifest.js';
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

  it('가로 16~512px, 세로가 가로의 2배면 받는다', () => {
    expect(problemsOf(upscaled(2))).toEqual([]);
    expect(problemsOf(upscaled(3))).toEqual([]);
  });

  it('범위를 벗어나거나 세로 비율이 다르면 거절한다', () => {
    const message = '캐릭터 해상도는 가로 16~512px, 세로는 가로의 2배여야 합니다.';
    expect(problemsOf({ ...base, width: 8, height: 16 })).toContain(message);
    expect(problemsOf({ ...base, width: 1024, height: 2048 })).toContain(message);
    expect(problemsOf({ ...base, width: 32, height: 32 })).toContain(message);
  });

  it('해상도 × 프레임 수가 너무 많으면 거절한다', () => {
    // 가장 큰 해상도(512×1024)는 32프레임까지다 (ASSET_PIXEL_BUDGET).
    const big = upscaled(32);
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

  it('키가 겹치거나, 필수 애니메이션에 달거나, 캐릭터가 아니면 거절한다', () => {
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
    ).toContain('필수 애니메이션');
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
