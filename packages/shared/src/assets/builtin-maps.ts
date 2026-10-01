import { PlazaMap, PlazaStyle } from '../domain/plaza.js';
import type { MapLayout } from '../plaza/layout.js';
import { builtinAsset } from './builtin-data.js';
import type { AssetRef } from './manifest.js';
import { type MapDefinition, type MapObject, buildCollision } from './map.js';
import { encodePixels } from './pixels.js';

/** Kenney Tiny Town 타일 번호 → 에셋 참조 */
const tt = (n: number): AssetRef => `builtin:tt-${n}`;

const GRASS = tt(0);
const GRASS_TUFT = tt(1);
const GRASS_FLOWER = tt(2);
const STONE_PATH = tt(43);
/** 흙 9칸 조각: 왼쪽 위부터 row-major */
const DIRT = [12, 13, 14, 24, 25, 26, 36, 37, 38].map(tt);
/** 가장자리를 두르는 나무 (칸마다 다르게) */
const BORDER_TREES = [4, 16, 28, 4, 16, 3, 15].map(tt);
const DECOR = [tt(17), tt(29)];

/** 타일 좌표에서 만든 고정 난수 (0 이상 1 미만). 풀 무늬가 매번 같게 나온다 */
function noise(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

class MapBuilder {
  private readonly tiles: AssetRef[] = [];
  private readonly ground: Uint8Array;
  private readonly overlay: Uint8Array;
  private readonly objects: MapObject[] = [];

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.ground = new Uint8Array(width * height);
    this.overlay = new Uint8Array(width * height);
  }

  private index(ref: AssetRef): number {
    let i = this.tiles.indexOf(ref);
    if (i === -1) i = this.tiles.push(ref) - 1;
    return i + 1;
  }

  paint(layer: 'ground' | 'overlay', x: number, y: number, ref: AssetRef): this {
    if (x >= 0 && y >= 0 && x < this.width && y < this.height) {
      this[layer][y * this.width + x] = this.index(ref);
    }
    return this;
  }

  fill(layer: 'ground' | 'overlay', x: number, y: number, w: number, h: number, ref: AssetRef) {
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) this.paint(layer, xx, yy, ref);
    return this;
  }

  /** 풀밭: 대부분 잔디, 가끔 풀과 꽃 */
  grass(): this {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const n = noise(x, y);
        this.paint('ground', x, y, n < 0.1 ? GRASS_TUFT : n < 0.14 ? GRASS_FLOWER : GRASS);
      }
    }
    return this;
  }

  /** 흙 바닥: 가장자리는 풀과 이어지는 조각 */
  dirt(x: number, y: number, w: number, h: number): this {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const col = xx === x ? 0 : xx === x + w - 1 ? 2 : 1;
        const row = yy === y ? 0 : yy === y + h - 1 ? 2 : 1;
        this.paint('ground', xx, yy, DIRT[row * 3 + col]!);
      }
    }
    return this;
  }

  /** 맵 가장자리를 나무로 두른다 (지나갈 수 없음) */
  treeBorder(): this {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (x > 0 && y > 0 && x < this.width - 1 && y < this.height - 1) continue;
        const pick = Math.floor(noise(x, y, 3) * BORDER_TREES.length);
        this.paint('overlay', x, y, BORDER_TREES[pick]!);
      }
    }
    return this;
  }

  object(asset: AssetRef, x: number, y: number): this {
    this.objects.push({ asset, x, y });
    return this;
  }

  objectsAt(): readonly MapObject[] {
    return this.objects;
  }

  /** 비어 있는 풀밭 칸에 새싹·버섯을 드문드문 (오브젝트 근처는 빼고) */
  sprinkle(): this {
    const grass = new Set([GRASS, GRASS_TUFT].map((ref) => this.tiles.indexOf(ref) + 1));
    for (let y = 1; y < this.height - 1; y++) {
      for (let x = 1; x < this.width - 1; x++) {
        const i = y * this.width + x;
        if (this.overlay[i] || !grass.has(this.ground[i]!) || near(this.objects, x, y)) continue;
        const n = noise(x, y, 9);
        if (n < 0.03) this.paint('overlay', x, y, DECOR[n < 0.018 ? 0 : 1]!);
      }
    }
    return this;
  }

  isEmpty(layer: 'ground' | 'overlay', x: number, y: number): boolean {
    return this[layer][y * this.width + x] === 0;
  }

  build(spawn: MapDefinition['spawn'], style?: PlazaStyle): MapDefinition {
    return {
      width: this.width,
      height: this.height,
      tiles: this.tiles,
      ground: encodePixels(this.ground),
      overlay: encodePixels(this.overlay),
      objects: this.objects,
      spawn,
      ...(style ? { style } : {}),
    };
  }
}

/** 오브젝트가 차지하는 칸 근처에는 장식을 뿌리지 않는다 */
function near(objects: readonly MapObject[], x: number, y: number) {
  return objects.some((o) => x >= o.x - 1 && x <= o.x + 3 && y >= o.y - 3 && y <= o.y + 1);
}

/** 분수 광장: 커뮤니티마다 하나. 흙 광장 가운데 분수, 사방으로 돌길, 가장자리는 숲 */
function fountainSquare(): MapDefinition {
  const map = new MapBuilder(48, 36).grass();
  map.dirt(12, 8, 24, 20);
  map.fill('ground', 22, 1, 4, 7, STONE_PATH);
  map.fill('ground', 22, 28, 4, 7, STONE_PATH);
  map.fill('ground', 1, 16, 11, 4, STONE_PATH);
  map.fill('ground', 36, 16, 11, 4, STONE_PATH);
  map.treeBorder();

  map.object('builtin:fountain', 22, 19);
  for (const [x, y] of [
    [15, 12],
    [31, 12],
    [15, 24],
    [31, 24],
  ] as const) {
    map.object('builtin:bench', x, y);
  }
  for (const [x, y] of [
    [21, 5],
    [26, 5],
    [21, 31],
    [26, 31],
    [6, 15],
    [6, 21],
    [41, 15],
    [41, 21],
  ] as const) {
    map.object('builtin:lamp', x, y);
  }
  for (const [x, y] of [
    [3, 6],
    [43, 6],
    [3, 33],
    [43, 33],
  ] as const) {
    map.object('builtin:big-tree', x, y);
  }
  for (const [x, y] of [
    [8, 4],
    [38, 4],
    [9, 31],
    [37, 31],
    [2, 12],
    [45, 12],
    [2, 26],
    [45, 26],
    [16, 3],
    [31, 3],
  ] as const) {
    map.object('builtin:pine', x, y);
  }
  map.paint('overlay', 9, 25, tt(104)); // 우물
  map.paint('overlay', 27, 2, tt(83)); // 표지판
  return map.sprinkle().build({ x: 19, y: 21, w: 10, h: 4 });
}

/** 모닥불 캠프: DM마다 하나. 숲속 공터 가운데 모닥불, 둘레에 통나무 */
function campfire(): MapDefinition {
  const map = new MapBuilder(16, 12).grass();
  map.dirt(3, 2, 10, 8);
  map.treeBorder();
  map.object('builtin:campfire', 7, 6);
  map.object('builtin:log', 6, 3);
  map.object('builtin:log', 8, 3);
  map.object('builtin:log-vertical', 4, 6);
  map.object('builtin:log-vertical', 11, 6);
  return map.sprinkle().build({ x: 5, y: 8, w: 6, h: 2 });
}

const SIDE = {
  grass: 'builtin:side-grass',
  dirt: 'builtin:side-dirt',
  stone: 'builtin:side-stone',
  rock: 'builtin:side-rock',
  crate: 'builtin:side-crate',
  plank: 'builtin:side-plank',
  tuft: 'builtin:side-grass-tuft',
  flowers: 'builtin:side-flowers',
} as const satisfies Record<string, AssetRef>;

/**
 * 옆에서 본 분수 광장: 횡스크롤 커뮤니티마다 하나. 가운데 돌바닥에 분수·벤치·가로등, 양쪽은 한 칸씩 오르는 언덕,
 * 하늘에는 점프로 오르는 나무 발판. 가로는 홀수라 분수가 한가운데에 온다.
 */
function fountainSide(): MapDefinition {
  const width = 63;
  const height = 20;
  const map = new MapBuilder(width, height);
  const middle = (width - 1) / 2;
  /** 땅 윗면의 줄: 가운데는 평평하고 양쪽 끝으로 갈수록 한 칸씩 오른다 */
  const surface = (x: number) => {
    const edge = Math.min(x, width - 1 - x);
    return edge < 5 ? 13 : edge < 9 ? 14 : edge < 13 ? 15 : 16;
  };
  const plaza = (x: number) => Math.abs(x - middle) <= 12;
  for (let x = 0; x < width; x++) {
    const top = surface(x);
    map.paint('ground', x, top, plaza(x) ? SIDE.stone : SIDE.grass);
    for (let y = top + 1; y < height - 1; y++) map.paint('ground', x, y, SIDE.dirt);
    map.paint('ground', x, height - 1, SIDE.rock);
  }
  /** 가운데를 기준으로 양쪽에 같은 것을 둔다 (w = 그림 폭, 타일) */
  const mirrored = (place: (x: number) => void, x: number, w = 1) => {
    place(x);
    place(width - x - w);
  };
  const stand = (asset: AssetRef) => (x: number) => map.object(asset, x, surface(x) - 1);

  map.object('builtin:fountain', middle - 1, surface(middle) - 1);
  mirrored(stand('builtin:bench'), 24, 2);
  mirrored(stand('builtin:lamp'), 21);
  mirrored(stand('builtin:lamp'), 11);
  mirrored(stand('builtin:pine'), 16);
  mirrored(stand('builtin:pine'), 7);
  mirrored(stand('builtin:big-tree'), 2, 2);
  // 뛰어넘을 나무 상자
  mirrored((x) => map.paint('ground', x, surface(x) - 1, SIDE.crate), 10);
  // 떠 있는 발판: 세 칸씩 위로 (점프 한 번에 오르는 높이). 위아래 발판이 두 칸씩 겹쳐서
  // 겹친 곳 아래에서 제자리 점프만 해도 (발판은 아래에서 뛰어 지나가므로) 한 층씩 오른다.
  for (const [x, y, w] of [
    [17, 13, 5],
    [20, 10, 7],
  ] as const) {
    mirrored((left) => map.fill('ground', left, y, w, 1, SIDE.plank), x, w);
  }
  map.fill('ground', middle - 6, 7, 13, 1, SIDE.plank);

  // 풀과 꽃: 땅 위 빈칸에 드문드문 (오브젝트와 상자 자리는 빼고)
  for (let x = 0; x < width; x++) {
    const y = surface(x) - 1;
    if (plaza(x) || !map.isEmpty('ground', x, y) || near(map.objectsAt(), x, y)) continue;
    const n = noise(x, y, 5);
    if (n < 0.35) map.paint('overlay', x, y, n < 0.12 ? SIDE.flowers : SIDE.tuft);
  }
  return map.build({ x: middle - 5, y: 12, w: 11, h: 4 }, PlazaStyle.SideScroll);
}

/** 내장 맵 (default 테마). 커뮤니티가 맵을 따로 만들지 않았으면 이것을 쓴다 */
export const BUILTIN_MAPS: Readonly<Record<PlazaMap, MapDefinition>> = {
  [PlazaMap.FountainSquare]: fountainSquare(),
  [PlazaMap.Campfire]: campfire(),
  [PlazaMap.FountainSide]: fountainSide(),
};

export const BUILTIN_LAYOUTS: Readonly<Record<PlazaMap, MapLayout>> = {
  [PlazaMap.FountainSquare]: buildCollision(BUILTIN_MAPS[PlazaMap.FountainSquare], builtinAsset),
  [PlazaMap.Campfire]: buildCollision(BUILTIN_MAPS[PlazaMap.Campfire], builtinAsset),
  [PlazaMap.FountainSide]: buildCollision(BUILTIN_MAPS[PlazaMap.FountainSide], builtinAsset),
};
