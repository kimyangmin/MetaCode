import { describe, expect, it } from 'vitest';
import { builtinAsset } from './builtin.js';
import {
  BUILTIN_CHARACTERS,
  characterChoiceSchema,
  characterKey,
  characterPalette,
  defaultCharacter,
} from './character.js';
import { colorRamp } from './pixels.js';

describe('defaultCharacter', () => {
  it('같은 사람은 늘 같은 기본 캐릭터, 여러 사람은 여러 모습', () => {
    expect(defaultCharacter('user-a')).toEqual(defaultCharacter('user-a'));
    const looks = new Set(
      Array.from({ length: 30 }, (_, i) => characterKey(defaultCharacter(`user-${i}`))),
    );
    expect(looks.size).toBeGreaterThan(20);
    const assets = new Set(
      Array.from({ length: 30 }, (_, i) => defaultCharacter(`user-${i}`).asset),
    );
    expect([...assets].sort()).toEqual([...BUILTIN_CHARACTERS].sort());
  });

  it('선택 검증을 통과한다', () => {
    expect(characterChoiceSchema.safeParse(defaultCharacter('x')).success).toBe(true);
    expect(
      characterChoiceSchema.safeParse({ asset: 'builtin:char-short', colors: { hair: 'red' } })
        .success,
    ).toBe(false);
  });
});

describe('characterPalette', () => {
  const manifest = builtinAsset('builtin:char-short')!;

  it('고른 부위의 세 칸만 colorRamp로 바꾼다', () => {
    const palette = characterPalette(manifest, { shirt: '#3f8fdb' });
    const shirt = manifest.colorSlots!.shirt!;
    expect(shirt.map((value) => palette[value - 1])).toEqual(colorRamp('#3f8fdb'));
    const changed = palette.filter((c, i) => c !== manifest.palette[i]);
    expect(changed).toHaveLength(3);
  });

  it('색 부위가 없는 캐릭터는 그대로', () => {
    const plain = { palette: ['#111111', '#222222'] };
    expect(characterPalette(plain, { shirt: '#3f8fdb' })).toEqual(plain.palette);
  });
});
