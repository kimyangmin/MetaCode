import { describe, expect, it } from 'vitest';
import { PlazaMap } from '../domain/plaza.js';
import { Cell, TILE_SIZE } from '../plaza/layout.js';
import { groundBelow, isGrounded, isSideScroll, isWalkable } from '../plaza/movement.js';
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

    it(`${key}: 가장자리는 막히고(횡스크롤은 바닥만) 스폰 영역은 모두 설 수 있다`, () => {
      for (let x = 0; x < map.width; x++) {
        if (!isSideScroll(layout)) expect(layout.blocked[x]).toBe(Cell.Solid);
        expect(layout.blocked[(map.height - 1) * map.width + x]).toBe(Cell.Solid);
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
    expect(assets(PlazaMap.FountainSide)).toContain('builtin:fountain');
    expect(assets(PlazaMap.Campfire)).toContain('builtin:campfire');
  });

  it('옆에서 본 분수 광장: 횡스크롤이고, 스폰 영역에서 떨어지면 광장 바닥에 선다', () => {
    const map = BUILTIN_MAPS[PlazaMap.FountainSide];
    const layout = BUILTIN_LAYOUTS[PlazaMap.FountainSide];
    expect(map.style).toBe('SIDE_SCROLL');
    const x = (map.width / 2) * TILE_SIZE;
    const ground = groundBelow(layout, x, map.spawn.y * TILE_SIZE + TILE_SIZE - 1);
    expect(ground).toBe(16 * TILE_SIZE);
    expect(isGrounded(layout, x, ground)).toBe(true);
    // 오브젝트(분수)는 배경이라 막지 않는다
    expect(layout.blocked.includes(Cell.Platform)).toBe(true);
    const fountain = map.objects.find((o) => o.asset === 'builtin:fountain')!;
    expect(layout.blocked[fountain.y * map.width + fountain.x]).toBe(Cell.Open);
  });

  it('옆에서 본 분수 광장: 발판은 점프 한 번(세 칸)으로 오를 수 있는 높이에 있다', () => {
    const map = BUILTIN_MAPS[PlazaMap.FountainSide];
    const layout = BUILTIN_LAYOUTS[PlazaMap.FountainSide];
    const rows = new Set<number>();
    layout.blocked.forEach((v, i) => {
      if (v === Cell.Platform) rows.add(Math.floor(i / map.width));
    });
    expect([...rows].sort((a, b) => a - b)).toEqual([7, 10, 13]);
  });
});
