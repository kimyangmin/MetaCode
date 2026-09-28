import { z } from 'zod';
import {
  type AssetManifest,
  type AssetRef,
  COLOR_SLOTS,
  type ColorSlot,
  assetRefSchema,
} from './manifest.js';
import { colorRamp } from './pixels.js';

/** 기본 캐릭터 (내장 에셋) */
export const BUILTIN_CHARACTERS: readonly AssetRef[] = ['builtin:char-short', 'builtin:char-long'];

/** 캐릭터 선택: 어떤 캐릭터 에셋을 쓰고, 색 부위를 어떤 색으로 바꿀지 */
export const characterChoiceSchema = z.object({
  asset: assetRefSchema,
  colors: z.partialRecord(z.enum(COLOR_SLOTS), z.string().regex(/^#[0-9a-f]{6}$/)),
});
export type CharacterChoice = z.infer<typeof characterChoiceSchema>;

/** 색 고르기에 보여 줄 색 (자유롭게 고를 수도 있다) */
export const COLOR_PRESETS: Record<ColorSlot, readonly string[]> = {
  skin: ['#fcbc8f', '#f1c7a0', '#e0a17a', '#c68660', '#9a6245', '#6f4431'],
  hair: ['#763b36', '#2b1d14', '#c9a063', '#1c1c1c', '#8a3b2a', '#5a6988', '#e38628'],
  shirt: ['#e84537', '#3f8fdb', '#57ab5a', '#c69026', '#986ee2', '#e275ad', '#39a6a8', '#e0823d'],
  pants: ['#5a6988', '#34405a', '#6b4a2b', '#3d3d3d', '#2f5d2a'],
  shoes: ['#4b3a35', '#1d1f24', '#8a5a33', '#ffffff'],
};

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 캐릭터를 고르지 않은 사람: 사용자 ID로 고른 기본 캐릭터와 색 (사람마다 늘 같다) */
export function defaultCharacter(userId: string): CharacterChoice {
  const h = hash(userId);
  const pick = <T>(list: readonly T[], shift: number) => list[(h >>> shift) % list.length]!;
  return {
    asset: pick(BUILTIN_CHARACTERS, 0),
    colors: {
      skin: pick(COLOR_PRESETS.skin, 3),
      hair: pick(COLOR_PRESETS.hair, 7),
      shirt: pick(COLOR_PRESETS.shirt, 11),
      pants: pick(COLOR_PRESETS.pants, 15),
    },
  };
}

/** 색 부위를 고른 색으로 바꾼 팔레트. 부위가 없는 캐릭터(직접 그린 것 등)는 그대로 */
export function characterPalette(
  manifest: Pick<AssetManifest, 'palette' | 'colorSlots'>,
  colors: CharacterChoice['colors'],
): string[] {
  const palette = [...manifest.palette];
  for (const slot of COLOR_SLOTS) {
    const indices = manifest.colorSlots?.[slot];
    const color = colors[slot];
    if (!indices || !color) continue;
    const ramp = colorRamp(color);
    indices.forEach((value, i) => {
      if (value >= 1 && value <= palette.length) palette[value - 1] = ramp[i]!;
    });
  }
  return palette;
}

/** 같은 모습이면 같은 값 (텍스처를 함께 쓰는 데 쓴다) */
export function characterKey(choice: CharacterChoice): string {
  const colors = COLOR_SLOTS.map((slot) => choice.colors[slot] ?? '-').join(',');
  return `${choice.asset}|${colors}`;
}
