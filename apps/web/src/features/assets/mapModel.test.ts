import { type MapDefinition, mapDefinitionSchema } from '@metacode/shared';
import { BUILTIN_MAPS } from '@metacode/shared/builtin-assets';
import { describe, expect, it } from 'vitest';
import { MapDocument, fromDefinition, toDefinition } from './mapModel';

const sizes: Record<string, { w: number; h: number }> = {
  'builtin:bench': { w: 2, h: 2 },
  'builtin:big-tree': { w: 2, h: 3 },
};
const sizeOf = (ref: string) => sizes[ref] ?? { w: 1, h: 1 };

const square = () => new MapDocument(fromDefinition(BUILTIN_MAPS['fountain-square']));

describe('맵 문서', () => {
  it('내장 맵을 불러와 그대로 저장하면 칸마다 같은 타일이다 (타일 목록 순서는 달라도 된다)', () => {
    const refs = (map: MapDefinition) => {
      const doc = new MapDocument(fromDefinition(map));
      return (['ground', 'overlay'] as const).map((layer) =>
        Array.from({ length: map.width * map.height }, (_, i) =>
          doc.tileAt(layer, i % map.width, Math.floor(i / map.width)),
        ),
      );
    };
    const saved = toDefinition(fromDefinition(BUILTIN_MAPS.campfire));
    expect(refs(saved)).toEqual(refs(BUILTIN_MAPS.campfire));
    expect(saved.objects).toEqual(BUILTIN_MAPS.campfire.objects);
    expect(saved.spawn).toEqual(BUILTIN_MAPS.campfire.spawn);
  });

  it('칠하고 지우고, 붓질 한 번은 되돌리기 한 번', () => {
    const map = square();
    map.begin();
    map.paint('ground', 5, 5, 'builtin:tt-43');
    map.paint('overlay', 6, 5, 'builtin:tt-29');
    expect(map.tileAt('ground', 5, 5)).toBe('builtin:tt-43');
    expect(map.dirty).toBe(true);
    map.undo();
    expect(map.tileAt('ground', 5, 5)).not.toBe('builtin:tt-43');
    expect(map.tileAt('overlay', 6, 5)).toBeNull();
  });

  it('쓰지 않게 된 타일은 저장할 때 목록에서 빠진다', () => {
    const map = new MapDocument(fromDefinition(BUILTIN_MAPS.campfire));
    map.begin();
    map.paint('ground', 1, 1, 'builtin:tt-43');
    map.paint('ground', 1, 1, 'builtin:tt-0');
    const saved = toDefinition(map.doc);
    expect(saved.tiles).not.toContain('builtin:tt-43');
    expect(mapDefinitionSchema.safeParse(saved).success).toBe(true);
  });

  it('채우기는 이어진 같은 타일만 바꾼다', () => {
    const map = new MapDocument({
      ...fromDefinition(BUILTIN_MAPS.campfire),
      ground: new Uint8Array(16 * 12).fill(1),
      tiles: ['builtin:tt-0'],
    });
    map.begin();
    for (let y = 0; y < 12; y++) map.paint('ground', 8, y, 'builtin:tt-43');
    map.fill('ground', 0, 0, 'builtin:tt-25');
    expect(map.tileAt('ground', 7, 11)).toBe('builtin:tt-25');
    expect(map.tileAt('ground', 9, 0)).toBe('builtin:tt-0');
  });

  it('지우개는 그 칸을 덮는 앞쪽 오브젝트부터 지우고, 없으면 장식 타일을 지운다', () => {
    const map = new MapDocument(fromDefinition(BUILTIN_MAPS.campfire));
    map.placeObject('builtin:big-tree', 2, 9); // (2~3, 7~9)를 덮는다
    map.placeObject('builtin:bench', 3, 8); // (3~4, 7~8), 아래쪽 끝이 나무보다 위
    map.begin();
    map.erase(3, 8, sizeOf); // 두 오브젝트가 겹친 칸: 앞에 그려지는 나무(아래쪽 끝 9)
    expect(map.doc.objects.map((o) => o.asset)).toContain('builtin:bench');
    expect(map.doc.objects.filter((o) => o.asset === 'builtin:big-tree')).toHaveLength(0);
    map.paint('overlay', 10, 10, 'builtin:tt-29');
    map.erase(10, 10, sizeOf);
    expect(map.tileAt('overlay', 10, 10)).toBeNull();
  });

  it('크기를 줄이면 밖의 오브젝트가 빠지고, 늘리면 잔디가 깔리며 스폰은 맵 안에 남는다', () => {
    const map = square();
    map.resize(20, 15);
    expect(map.doc.ground).toHaveLength(300);
    expect(map.doc.objects.every((o) => o.x < 20 && o.y < 15)).toBe(true);
    expect(map.doc.spawn.x + map.doc.spawn.w).toBeLessThanOrEqual(20);
    map.resize(24, 16);
    expect(map.tileAt('ground', 23, 15)).toBe('builtin:tt-0');
    const saved: MapDefinition = toDefinition(map.doc);
    expect(mapDefinitionSchema.safeParse(saved).success).toBe(true);
  });
});

describe('맵 채우기', () => {
  const doc = (tiles: string[]) =>
    new MapDocument({
      width: 12,
      height: 12,
      tiles,
      ground: new Uint8Array(144).fill(1),
      overlay: new Uint8Array(144),
      objects: [],
      spawn: { x: 0, y: 0, w: 2, h: 2 },
    });

  it('같은 타일이면 아무것도 바꾸지 않고 되돌리기 단계도 만들지 않는다', () => {
    const map = doc(['builtin:tt-0']);
    map.fill('ground', 3, 3, 'builtin:tt-0');
    expect(map.canUndo).toBe(false);
    expect(map.dirty).toBe(false);
  });

  it('타일 목록이 가득 차서 정리하게 돼도 채운 타일이 남는다', () => {
    // 쓰지 않는 타일로 목록을 가득 채운다 (격자는 첫 타일만 씀)
    const tiles = Array.from({ length: 255 }, (_, i) => `builtin:tt-${i}`);
    const map = doc(tiles);
    map.fill('ground', 3, 3, 'builtin:side-grass');
    expect(map.tileAt('ground', 0, 0)).toBe('builtin:side-grass');
    expect(map.tileAt('ground', 11, 11)).toBe('builtin:side-grass');
    map.undo();
    expect(map.tileAt('ground', 0, 0)).toBe('builtin:tt-0');
  });
});
