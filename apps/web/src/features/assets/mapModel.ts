import {
  type AssetRef,
  MAP_MAX_SIZE,
  MAP_MIN_SIZE,
  MAP_OBJECTS_MAX,
  MAP_TILE_KINDS_MAX,
  type MapDefinition,
  type MapObject,
  PlazaStyle,
  TILE_SIZE,
  decodePixels,
  encodePixels,
} from '@metacode/shared';

export type TileLayer = 'ground' | 'overlay';

/** 맵 에디터가 고치는 맵. 격자는 풀어 둔 바이트 배열이다 (값 v = tiles[v - 1], 0 = 빈칸) */
export interface MapDoc {
  width: number;
  height: number;
  tiles: AssetRef[];
  ground: Uint8Array;
  overlay: Uint8Array;
  objects: MapObject[];
  spawn: { x: number; y: number; w: number; h: number };
  /** 광장 방식. 없으면 탑다운 */
  style?: PlazaStyle;
}

export const isSideDoc = (doc: Pick<MapDoc, 'style'>) => doc.style === PlazaStyle.SideScroll;

/** 오브젝트 그림 크기 (타일 단위). 모르는 에셋은 1×1로 본다 */
export type SizeOf = (ref: AssetRef) => { w: number; h: number };

/** 새로 넓힌 칸에 깔 바닥 */
export const DEFAULT_GROUND: AssetRef = 'builtin:tt-0';

export function fromDefinition(map: MapDefinition): MapDoc {
  const cells = map.width * map.height;
  return {
    width: map.width,
    height: map.height,
    tiles: [...map.tiles],
    ground: decodePixels(map.ground) ?? new Uint8Array(cells),
    overlay: decodePixels(map.overlay) ?? new Uint8Array(cells),
    objects: map.objects.map((o) => ({ ...o })),
    spawn: { ...map.spawn },
    ...(map.style ? { style: map.style } : {}),
  };
}

/** 저장할 맵 정의. 쓰지 않는 타일은 목록에서 빼고 번호를 다시 매긴다 */
export function toDefinition(doc: MapDoc): MapDefinition {
  const compact = compactTiles(doc);
  return {
    width: doc.width,
    height: doc.height,
    tiles: compact.tiles,
    ground: encodePixels(compact.ground),
    overlay: encodePixels(compact.overlay),
    objects: doc.objects.map((o) => ({ ...o })),
    spawn: { ...doc.spawn },
    ...(doc.style ? { style: doc.style } : {}),
  };
}

function compactTiles(doc: MapDoc) {
  const tiles: AssetRef[] = [];
  const remap = new Map<number, number>();
  const map = (grid: Uint8Array) =>
    grid.map((v) => {
      if (v === 0) return 0;
      let next = remap.get(v);
      if (next === undefined) {
        next = tiles.push(doc.tiles[v - 1]!);
        remap.set(v, next);
      }
      return next;
    });
  const ground = map(doc.ground);
  const overlay = map(doc.overlay);
  return { tiles, ground, overlay };
}

function copyDoc(doc: MapDoc): MapDoc {
  return {
    ...doc,
    tiles: [...doc.tiles],
    ground: Uint8Array.from(doc.ground),
    overlay: Uint8Array.from(doc.overlay),
    objects: doc.objects.map((o) => ({ ...o })),
    spawn: { ...doc.spawn },
  };
}

/** 오브젝트 그림이 덮는 칸인지 ((x, y) = 놓은 칸 = 그림의 왼쪽 아래) */
function covers(object: MapObject, size: { w: number; h: number }, x: number, y: number): boolean {
  return x >= object.x && x < object.x + size.w && y <= object.y && y > object.y - size.h;
}

const UNDO_LIMIT = 100;

/** 맵 편집과 되돌리기. 한 번의 붓질은 begin()으로 시작해 되돌리기 한 번에 돌아간다 */
export class MapDocument {
  doc: MapDoc;
  version = 0;
  private undoStack: MapDoc[] = [];
  private redoStack: MapDoc[] = [];
  private savedVersion = 0;

  constructor(
    doc: MapDoc,
    private readonly onChange: () => void = () => {},
  ) {
    this.doc = doc;
  }

  get dirty(): boolean {
    return this.version !== this.savedVersion;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  markSaved(): void {
    this.savedVersion = this.version;
  }

  begin(): void {
    this.undoStack.push(copyDoc(this.doc));
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(this.doc);
    this.doc = previous;
    this.changed();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.doc);
    this.doc = next;
    this.changed();
  }

  /** 문서를 통째로 바꾼다 (서버에서 다시 받았을 때). 되돌리기 기록은 지운다 */
  replace(doc: MapDoc): void {
    this.doc = doc;
    this.undoStack = [];
    this.redoStack = [];
    this.changed();
    this.markSaved();
  }

  private changed(): void {
    this.version++;
    this.onChange();
  }

  private inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.doc.width && y < this.doc.height;
  }

  /** 타일 목록에서의 번호 (없으면 더한다). 목록이 가득 차면 안 쓰는 것을 정리하고, 그래도 없으면 null */
  private tileValue(ref: AssetRef): number | null {
    let index = this.doc.tiles.indexOf(ref);
    if (index !== -1) return index + 1;
    if (this.doc.tiles.length >= MAP_TILE_KINDS_MAX) {
      const compact = compactTiles(this.doc);
      Object.assign(this.doc, compact);
      if (this.doc.tiles.length >= MAP_TILE_KINDS_MAX) return null;
    }
    index = this.doc.tiles.push(ref) - 1;
    return index + 1;
  }

  tileAt(layer: TileLayer, x: number, y: number): AssetRef | null {
    if (!this.inside(x, y)) return null;
    const v = this.doc[layer][y * this.doc.width + x]!;
    return v > 0 ? this.doc.tiles[v - 1]! : null;
  }

  /** 칸 하나 칠하기 (begin() 다음에 여러 번). ref가 null이면 지운다 */
  paint(layer: TileLayer, x: number, y: number, ref: AssetRef | null): void {
    if (!this.inside(x, y)) return;
    const value = ref ? this.tileValue(ref) : 0;
    if (value === null) return;
    const grid = this.doc[layer];
    const i = y * this.doc.width + x;
    if (grid[i] === value) return;
    grid[i] = value;
    this.changed();
  }

  /** 같은 타일로 이어진 영역 칠하기 (상하좌우) */
  fill(layer: TileLayer, x: number, y: number, ref: AssetRef): void {
    if (!this.inside(x, y)) return;
    const grid = this.doc[layer];
    const { width, height } = this.doc;
    const target = grid[y * width + x]!;
    this.begin();
    const value = this.tileValue(ref);
    if (value === null || value === target) return;
    const stack = [y * width + x];
    while (stack.length > 0) {
      const i = stack.pop()!;
      if (grid[i] !== target) continue;
      grid[i] = value;
      const px = i % width;
      if (px > 0) stack.push(i - 1);
      if (px < width - 1) stack.push(i + 1);
      if (i >= width) stack.push(i - width);
      if (i < width * (height - 1)) stack.push(i + width);
    }
    this.changed();
  }

  /** 오브젝트 놓기 ((x, y) = 그림의 왼쪽 아래 칸). 같은 자리에 같은 것이 있으면 무시 */
  placeObject(ref: AssetRef, x: number, y: number): boolean {
    if (!this.inside(x, y) || this.doc.objects.length >= MAP_OBJECTS_MAX) return false;
    if (this.doc.objects.some((o) => o.asset === ref && o.x === x && o.y === y)) return false;
    this.begin();
    this.doc.objects.push({ asset: ref, x, y });
    this.changed();
    return true;
  }

  /** 이 칸을 덮는 오브젝트 중 앞에 그려지는 것 (아래쪽 끝이 가장 아래, 같으면 나중에 놓은 것) */
  objectAt(x: number, y: number, sizeOf: SizeOf): number {
    let found = -1;
    this.doc.objects.forEach((object, i) => {
      if (!covers(object, sizeOf(object.asset), x, y)) return;
      if (found === -1 || object.y >= this.doc.objects[found]!.y) found = i;
    });
    return found;
  }

  /**
   * 지우개: 그 칸의 오브젝트, 없으면 장식 타일을 지운다 (begin() 다음에 여러 번).
   * 횡스크롤은 빈칸이 하늘이라 바닥 타일도 지운다 (탑다운 바닥은 늘 칠해져 있어야 한다).
   */
  erase(x: number, y: number, sizeOf: SizeOf): void {
    const index = this.objectAt(x, y, sizeOf);
    if (index !== -1) {
      this.doc.objects.splice(index, 1);
      this.changed();
      return;
    }
    if (isSideDoc(this.doc) && !this.tileAt('overlay', x, y)) this.paint('ground', x, y, null);
    else this.paint('overlay', x, y, null);
  }

  setSpawn(spawn: MapDoc['spawn']): void {
    const x = Math.max(0, Math.min(spawn.x, this.doc.width - 1));
    const y = Math.max(0, Math.min(spawn.y, this.doc.height - 1));
    const w = Math.max(1, Math.min(spawn.w, this.doc.width - x));
    const h = Math.max(1, Math.min(spawn.h, this.doc.height - y));
    this.begin();
    this.doc.spawn = { x, y, w, h };
    this.changed();
  }

  /**
   * 크기 바꾸기: 왼쪽 위를 기준으로 자르거나 늘린다. 늘린 칸은 잔디(횡스크롤은 하늘), 밖으로 나간 오브젝트는 뺀다
   */
  resize(width: number, height: number): void {
    width = Math.max(MAP_MIN_SIZE, Math.min(MAP_MAX_SIZE, Math.round(width)));
    height = Math.max(MAP_MIN_SIZE, Math.min(MAP_MAX_SIZE, Math.round(height)));
    const old = this.doc;
    if (width === old.width && height === old.height) return;
    this.begin();
    const grass = isSideDoc(old) ? 0 : (this.tileValue(DEFAULT_GROUND) ?? 0);
    const ground = new Uint8Array(width * height).fill(grass);
    const overlay = new Uint8Array(width * height);
    for (let y = 0; y < Math.min(height, old.height); y++) {
      for (let x = 0; x < Math.min(width, old.width); x++) {
        ground[y * width + x] = old.ground[y * old.width + x]!;
        overlay[y * width + x] = old.overlay[y * old.width + x]!;
      }
    }
    this.doc = {
      ...old,
      width,
      height,
      ground,
      overlay,
      objects: old.objects.filter((o) => o.x < width && o.y < height),
    };
    this.doc.spawn = {
      x: Math.min(old.spawn.x, width - 1),
      y: Math.min(old.spawn.y, height - 1),
      w: Math.max(1, Math.min(old.spawn.w, width - Math.min(old.spawn.x, width - 1))),
      h: Math.max(1, Math.min(old.spawn.h, height - Math.min(old.spawn.y, height - 1))),
    };
    this.changed();
  }
}

/** 오브젝트 매니페스트 크기(px) → 타일 단위 */
export function tileSize(size: { width: number; height: number } | undefined) {
  return size
    ? { w: Math.max(1, size.width / TILE_SIZE), h: Math.max(1, size.height / TILE_SIZE) }
    : { w: 1, h: 1 };
}
