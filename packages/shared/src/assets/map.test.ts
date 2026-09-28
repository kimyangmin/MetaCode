import { describe, expect, it } from 'vitest';
import type { AssetCollision, MapDefinition } from './map.js';
import { buildCollision, mapAssetProblems, mapDefinitionSchema, mapProblems } from './map.js';
import { encodePixels } from './pixels.js';

const W = 16;
const H = 12;

function grid(fill: (x: number, y: number) => number) {
  const cells = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) cells[y * W + x] = fill(x, y);
  return encodePixels(cells);
}

const META: Record<string, AssetCollision> = {
  'builtin:grass': { kind: 'tile', width: 16, height: 16, solid: false },
  'builtin:wall': { kind: 'tile', width: 16, height: 16, solid: true },
  'builtin:tree': { kind: 'object', width: 32, height: 48, footprint: [0, 0, 0, 0, 1, 1] },
};
const metaOf = (ref: string) => META[ref];

const map = (overrides: Partial<MapDefinition> = {}): MapDefinition => ({
  width: W,
  height: H,
  tiles: ['builtin:grass', 'builtin:wall'],
  ground: grid((x) => (x === 0 ? 2 : 1)),
  overlay: grid(() => 0),
  objects: [{ asset: 'builtin:tree', x: 5, y: 6 }],
  spawn: { x: 2, y: 2, w: 3, h: 3 },
  ...overrides,
});

describe('buildCollision', () => {
  it('solid 타일과 오브젝트의 막힌 칸을 막는다', () => {
    const { blocked } = buildCollision(map(), metaOf);
    const at = (x: number, y: number) => blocked[y * W + x];
    expect(at(0, 3)).toBe(1); // 벽 타일
    expect(at(1, 3)).toBe(0); // 잔디
    expect(at(5, 6)).toBe(1); // 나무 밑동 (놓은 칸)
    expect(at(6, 6)).toBe(1);
    expect(at(5, 5)).toBe(0); // 나무 윗부분은 지나갈 수 있다
  });

  it('장식 층의 solid 타일도 막고, 모르는 에셋은 막지 않는다', () => {
    const { blocked } = buildCollision(
      map({
        overlay: grid((x, y) => (x === 3 && y === 3 ? 2 : 0)),
        objects: [{ asset: 'builtin:없음', x: 8, y: 8 }],
      }),
      metaOf,
    );
    expect(blocked[3 * W + 3]).toBe(1);
    expect(blocked[8 * W + 8]).toBe(0);
  });
});

describe('맵 검증', () => {
  it('올바른 맵은 통과한다', () => {
    expect(mapDefinitionSchema.safeParse(map()).success).toBe(true);
    expect(mapAssetProblems(map(), metaOf)).toEqual([]);
  });

  it('격자 크기, 목록에 없는 타일, 맵 밖 스폰·오브젝트를 거절한다', () => {
    expect(mapProblems(map({ ground: encodePixels(new Uint8Array(3)) }))).toContain(
      '바닥 층의 크기가 맞지 않습니다.',
    );
    expect(mapProblems(map({ overlay: grid(() => 3) }))).toContain(
      '장식 층에 목록에 없는 타일이 있습니다.',
    );
    expect(mapProblems(map({ spawn: { x: 14, y: 0, w: 4, h: 1 } }))).toContain(
      '스폰 영역이 맵 밖에 있습니다.',
    );
    expect(mapProblems(map({ objects: [{ asset: 'builtin:tree', x: 16, y: 1 }] }))).toContain(
      '맵 밖에 놓인 오브젝트가 있습니다.',
    );
  });

  it('없는 에셋이나 종류가 다른 에셋을 쓰면 알려 준다', () => {
    const problems = mapAssetProblems(
      map({
        tiles: ['builtin:tree', 'builtin:없음'],
        objects: [{ asset: 'builtin:wall', x: 1, y: 1 }],
      }),
      metaOf,
    );
    expect(problems).toEqual([
      'builtin:tree: 타일이 아닙니다.',
      '없는 에셋을 씁니다: builtin:없음',
      'builtin:wall: 오브젝트가 아닙니다.',
    ]);
  });
});
