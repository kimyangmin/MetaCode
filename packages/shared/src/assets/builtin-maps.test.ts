import { describe, expect, it } from 'vitest';
import { PlazaMap } from '../domain/plaza.js';
import { TILE_SIZE } from '../plaza/layout.js';
import { isWalkable } from '../plaza/movement.js';
import { BUILTIN_LAYOUTS, BUILTIN_MAPS, builtinAsset } from './builtin.js';
import { mapAssetProblems, mapDefinitionSchema } from './map.js';

describe('내장 맵', () => {
  for (const key of Object.values(PlazaMap)) {
    const map = BUILTIN_MAPS[key];
    const layout = BUILTIN_LAYOUTS[key];

    it(`${key}: 맵 검증을 통과하고 쓰는 에셋이 모두 있다`, () => {
      const result = mapDefinitionSchema.safeParse(map);
      expect(result.success, result.error?.message).toBe(true);
      expect(mapAssetProblems(map, builtinAsset)).toEqual([]);
    });

    it(`${key}: 가장자리는 막히고 스폰 영역은 모두 설 수 있다`, () => {
      for (let x = 0; x < map.width; x++) {
        expect(layout.blocked[x]).toBe(1);
        expect(layout.blocked[(map.height - 1) * map.width + x]).toBe(1);
      }
      const { spawn } = map;
      for (let y = spawn.y; y < spawn.y + spawn.h; y++) {
        for (let x = spawn.x; x < spawn.x + spawn.w; x++) {
          expect(isWalkable(layout, x * TILE_SIZE + 8, y * TILE_SIZE + 15), `${x},${y}`).toBe(true);
        }
      }
    });
  }

  it('분수 광장 가운데에 분수, 모닥불 캠프 가운데에 모닥불이 있다', () => {
    const assets = (key: PlazaMap) => BUILTIN_MAPS[key].objects.map((o) => o.asset);
    expect(assets(PlazaMap.FountainSquare)).toContain('builtin:fountain');
    expect(assets(PlazaMap.Campfire)).toContain('builtin:campfire');
  });
});
