import {
  type AssetKind,
  type AssetManifest,
  CHARACTER_DEFAULT_WIDTH,
  CHARACTER_MAX_WIDTH,
  CHARACTER_MIN_WIDTH,
  DEFAULT_ANIMATION,
  FRAME_LIMIT,
  PALETTE_MAX_COLORS,
  REQUIRED_CHARACTER_ANIMATIONS,
  TILE_SIZE,
  characterHeightOf,
  decodePixels,
  encodePixels,
} from '@metacode/shared';
import { type Rect, emptyRowsBelow, shiftPixels } from './selection';

/**
 * 도트 에디터가 고치는 문서. 매니페스트는 애니메이션이 프레임을 번호로 함께 쓰지만(같은 그림 한 번만 저장),
 * 에디터에서는 애니메이션마다 자기 프레임을 가진다. 저장할 때 같은 그림을 합친다 (toManifest).
 */
export interface EditorAnimation {
  name: string;
  frames: Uint8Array[];
  frameMs: number;
}

export interface EditorDoc {
  kind: AssetKind;
  name: string;
  width: number;
  height: number;
  /** 픽셀 값 v(1 이상) = palette[v - 1], 0 = 투명 */
  palette: string[];
  animations: EditorAnimation[];
  solid: boolean;
  footprint: number[];
  colorSlots?: AssetManifest['colorSlots'];
}

/** 새로 그릴 때의 팔레트: Kenney Tiny Town 색 위주 */
export const STARTER_PALETTE = [
  '#3f2631',
  '#ffffff',
  '#c0cbdc',
  '#8b9bb4',
  '#5a6988',
  '#262b44',
  '#84c669',
  '#479f4a',
  '#eaa56c',
  '#bd6c4a',
  '#763b36',
  '#fdbe53',
  '#e38628',
  '#e84537',
  '#009adc',
  '#fcbc8f',
];

const blank = (width: number, height: number) => new Uint8Array(width * height);

/** 오브젝트의 기본 막힌 칸: 아래 줄만 (위쪽은 캐릭터가 뒤로 지나갈 수 있게) */
function defaultFootprint(width: number, height: number): number[] {
  const cols = Math.round(width / TILE_SIZE);
  const cells = cols * Math.round(height / TILE_SIZE);
  return Array.from({ length: cells }, (_, i) => (i >= cells - cols ? 1 : 0));
}

/** 종류에 맞는 새 문서. 캐릭터는 필수 애니메이션을 빈 프레임으로 채워 둔다 */
export function newDoc(kind: AssetKind, name: string, tiles = { w: 1, h: 1 }): EditorDoc {
  const width =
    kind === 'character'
      ? CHARACTER_DEFAULT_WIDTH
      : kind === 'tile'
        ? TILE_SIZE
        : tiles.w * TILE_SIZE;
  const height =
    kind === 'character'
      ? characterHeightOf(CHARACTER_DEFAULT_WIDTH)
      : kind === 'tile'
        ? TILE_SIZE
        : tiles.h * TILE_SIZE;
  const animations =
    kind === 'character'
      ? REQUIRED_CHARACTER_ANIMATIONS.map((required) => ({
          name: required.name,
          frames: Array.from({ length: required.minFrames }, () => blank(width, height)),
          frameMs: required.name.startsWith('idle') ? 1000 : 120,
        }))
      : [{ name: DEFAULT_ANIMATION, frames: [blank(width, height)], frameMs: 200 }];
  return {
    kind,
    name,
    width,
    height,
    palette: [...STARTER_PALETTE],
    animations,
    solid: false,
    footprint: defaultFootprint(width, height),
  };
}

export function fromManifest(manifest: AssetManifest): EditorDoc {
  const frames = manifest.frames.map(
    (f) => decodePixels(f) ?? blank(manifest.width, manifest.height),
  );
  const order =
    manifest.kind === 'character'
      ? [
          ...REQUIRED_CHARACTER_ANIMATIONS.map((r) => r.name),
          ...Object.keys(manifest.animations).filter(
            (name) => !REQUIRED_CHARACTER_ANIMATIONS.some((r) => r.name === name),
          ),
        ]
      : Object.keys(manifest.animations);
  const animations = order.map((name) => {
    const animation = manifest.animations[name];
    return {
      name,
      frames: animation
        ? animation.frames.map((i) =>
            Uint8Array.from(frames[i] ?? blank(manifest.width, manifest.height)),
          )
        : [blank(manifest.width, manifest.height)],
      frameMs: animation?.frameMs ?? 120,
    };
  });
  const cells = Math.round(manifest.width / TILE_SIZE) * Math.round(manifest.height / TILE_SIZE);
  return {
    kind: manifest.kind,
    name: manifest.name,
    width: manifest.width,
    height: manifest.height,
    palette: [...manifest.palette],
    animations,
    solid: manifest.solid ?? false,
    footprint: manifest.footprint ? [...manifest.footprint] : Array<number>(cells).fill(0),
    colorSlots: manifest.colorSlots,
  };
}

/** 저장할 매니페스트. 같은 그림의 프레임은 하나로 합친다 */
export function toManifest(doc: EditorDoc): AssetManifest {
  const frames: string[] = [];
  const indexOf = new Map<string, number>();
  const animations: AssetManifest['animations'] = {};
  for (const animation of doc.animations) {
    animations[animation.name] = {
      frameMs: animation.frameMs,
      frames: animation.frames.map((pixels) => {
        const encoded = encodePixels(pixels);
        let index = indexOf.get(encoded);
        if (index === undefined) {
          index = frames.push(encoded) - 1;
          indexOf.set(encoded, index);
        }
        return index;
      }),
    };
  }
  return {
    kind: doc.kind,
    name: doc.name.trim(),
    width: doc.width,
    height: doc.height,
    palette: [...doc.palette],
    frames,
    animations,
    ...(doc.kind === 'tile' ? { solid: doc.solid } : {}),
    ...(doc.kind === 'object' ? { footprint: doc.footprint.map((v) => (v ? 1 : 0) as 0 | 1) } : {}),
    ...(doc.kind === 'character' && doc.colorSlots ? { colorSlots: doc.colorSlots } : {}),
  };
}

function copyDoc(doc: EditorDoc): EditorDoc {
  return {
    ...doc,
    palette: [...doc.palette],
    animations: doc.animations.map((a) => ({
      ...a,
      frames: a.frames.map((f) => Uint8Array.from(f)),
    })),
    footprint: [...doc.footprint],
  };
}

export interface FrameRef {
  animation: number;
  frame: number;
}

const UNDO_LIMIT = 100;

/**
 * 편집 작업과 되돌리기. 한 번의 붓질(누르고 떼기까지)은 begin()으로 시작해 되돌리기 한 번에 돌아간다.
 * 바뀔 때마다 version이 오르고 onChange를 부른다 (화면이 다시 그린다).
 */
export class PixelDocument {
  doc: EditorDoc;
  version = 0;
  private undoStack: EditorDoc[] = [];
  private redoStack: EditorDoc[] = [];
  private savedVersion = 0;
  /** 마지막 edit()의 묶음 키. 같은 키로 이어서 바꾸면(색 고르기 드래그 등) 되돌리기 한 단계로 묶는다 */
  private lastKey: string | null = null;

  constructor(
    doc: EditorDoc,
    private readonly onChange: () => void = () => {},
  ) {
    this.doc = doc;
  }

  get dirty(): boolean {
    return this.version !== this.savedVersion;
  }

  markSaved(): void {
    this.savedVersion = this.version;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** 이 뒤의 변경을 한 단계로 묶는다 */
  begin(): void {
    this.lastKey = null;
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

  private changed(): void {
    this.version++;
    this.onChange();
  }

  /** 한 단계로 바꾼다. key가 바로 앞의 edit()와 같으면 그 단계에 합친다 */
  edit(change: (doc: EditorDoc) => void, key?: string): void {
    if (!key || key !== this.lastKey) {
      this.begin();
      this.lastKey = key ?? null;
    }
    change(this.doc);
    this.changed();
  }

  frame(ref: FrameRef): Uint8Array | undefined {
    return this.doc.animations[ref.animation]?.frames[ref.frame];
  }

  /** 프레임 한 장을 통째로 바꾼다 (begin() 다음에 부른다. 선택 영역 옮기기처럼 매번 처음부터 다시 만들 때) */
  setFrame(ref: FrameRef, pixels: Uint8Array): void {
    const frames = this.doc.animations[ref.animation]?.frames;
    if (!frames || ref.frame >= frames.length) return;
    frames[ref.frame] = pixels;
    this.changed();
  }

  pick(ref: FrameRef, x: number, y: number): number {
    return this.frame(ref)?.[y * this.doc.width + x] ?? 0;
  }

  /** 점 하나 (begin() 다음에 여러 번 부른다). mirror면 좌우 대칭 자리에도 칠한다 */
  paint(ref: FrameRef, x: number, y: number, value: number, mirror = false): void {
    const pixels = this.frame(ref);
    const { width, height } = this.doc;
    if (!pixels) return;
    let touched = false;
    for (const px of mirror ? [x, width - 1 - x] : [x]) {
      if (px < 0 || y < 0 || px >= width || y >= height) continue;
      if (pixels[y * width + px] === value) continue;
      pixels[y * width + px] = value;
      touched = true;
    }
    if (touched) this.changed();
  }

  /** 선: 마우스를 빨리 움직여도 점이 끊기지 않게 두 점 사이를 잇는다 (브레젠험) */
  line(
    ref: FrameRef,
    from: { x: number; y: number },
    to: { x: number; y: number },
    value: number,
    mirror = false,
  ) {
    let { x, y } = from;
    const dx = Math.abs(to.x - x);
    const dy = -Math.abs(to.y - y);
    const sx = x < to.x ? 1 : -1;
    const sy = y < to.y ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.paint(ref, x, y, value, mirror);
      if (x === to.x && y === to.y) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  /** 같은 색으로 이어진 영역 칠하기 (상하좌우) */
  fill(ref: FrameRef, x: number, y: number, value: number): void {
    const pixels = this.frame(ref);
    const { width, height } = this.doc;
    if (!pixels || x < 0 || y < 0 || x >= width || y >= height) return;
    const target = pixels[y * width + x];
    if (target === value) return;
    this.begin();
    const stack = [y * width + x];
    while (stack.length > 0) {
      const i = stack.pop()!;
      if (pixels[i] !== target) continue;
      pixels[i] = value;
      const px = i % width;
      if (px > 0) stack.push(i - 1);
      if (px < width - 1) stack.push(i + 1);
      if (i >= width) stack.push(i - width);
      if (i < width * (height - 1)) stack.push(i + width);
    }
    this.changed();
  }

  // ── 프레임 ──

  /** 프레임을 넣고 그 번호를 돌려준다. copy면 지금 프레임을 복제한다 */
  addFrame(ref: FrameRef, copy: boolean): number | null {
    const animation = this.doc.animations[ref.animation];
    if (!animation || this.frameCount() >= FRAME_LIMIT[this.doc.kind]) return null;
    const source = animation.frames[ref.frame];
    this.edit((doc) => {
      const pixels = copy && source ? Uint8Array.from(source) : blank(doc.width, doc.height);
      doc.animations[ref.animation]!.frames.splice(ref.frame + 1, 0, pixels);
    });
    return ref.frame + 1;
  }

  removeFrame(ref: FrameRef): void {
    const animation = this.doc.animations[ref.animation];
    if (!animation || animation.frames.length <= 1) return;
    this.edit((doc) => doc.animations[ref.animation]!.frames.splice(ref.frame, 1));
  }

  moveFrame(ref: FrameRef, to: number): void {
    const frames = this.doc.animations[ref.animation]?.frames;
    if (!frames || to < 0 || to >= frames.length || to === ref.frame) return;
    this.edit((doc) => {
      const list = doc.animations[ref.animation]!.frames;
      const [moved] = list.splice(ref.frame, 1);
      list.splice(to, 0, moved!);
    });
  }

  setFrameMs(animation: number, frameMs: number): void {
    this.edit((doc) => {
      doc.animations[animation]!.frameMs = frameMs;
    });
  }

  /** 저장할 때의 프레임 수 (같은 그림은 하나로 센다) */
  frameCount(): number {
    const seen = new Set<string>();
    for (const a of this.doc.animations) for (const f of a.frames) seen.add(encodePixels(f));
    return seen.size;
  }

  // ── 팔레트 ──

  addColor(hex: string): number | null {
    if (this.doc.palette.length >= PALETTE_MAX_COLORS) return null;
    const existing = this.doc.palette.indexOf(hex);
    if (existing !== -1) return existing + 1;
    this.edit((doc) => doc.palette.push(hex));
    return this.doc.palette.length;
  }

  setColor(value: number, hex: string): void {
    if (value < 1 || value > this.doc.palette.length) return;
    this.edit((doc) => {
      doc.palette[value - 1] = hex;
    }, `color:${value}`);
  }

  /** 색을 지운다. 그 색으로 칠한 픽셀은 투명해지고, 뒤의 색 번호는 하나씩 당겨진다 */
  removeColor(value: number): void {
    if (value < 1 || value > this.doc.palette.length) return;
    this.edit((doc) => {
      doc.palette.splice(value - 1, 1);
      for (const animation of doc.animations) {
        for (const pixels of animation.frames) {
          for (let i = 0; i < pixels.length; i++) {
            const v = pixels[i]!;
            if (v === value) pixels[i] = 0;
            else if (v > value) pixels[i] = v - 1;
          }
        }
      }
      if (doc.colorSlots) {
        doc.colorSlots = Object.fromEntries(
          Object.entries(doc.colorSlots)
            .filter(([, indices]) => !indices.includes(value))
            .map(([slot, indices]) => [slot, indices.map((v) => (v > value ? v - 1 : v))]),
        );
      }
    });
  }

  // ── 종류별 설정 ──

  setName(name: string): void {
    this.doc.name = name;
    this.changed();
  }

  setSolid(solid: boolean): void {
    this.edit((doc) => {
      doc.solid = solid;
    });
  }

  toggleFootprint(cell: number): void {
    this.edit((doc) => {
      doc.footprint[cell] = doc.footprint[cell] ? 0 : 1;
    });
  }

  /**
   * 오브젝트 크기 바꾸기 (타일 단위). 그림은 왼쪽 아래를 기준으로 남기고,
   * 막힌 칸도 아래쪽을 기준으로 옮긴다 (새로 생긴 칸은 열림).
   */
  resize(tilesW: number, tilesH: number): void {
    const width = tilesW * TILE_SIZE;
    const height = tilesH * TILE_SIZE;
    const old = this.doc;
    if (width === old.width && height === old.height) return;
    this.edit((doc) => {
      const dy = height - old.height;
      for (const animation of doc.animations) {
        animation.frames = animation.frames.map((pixels) => {
          const next = blank(width, height);
          for (let y = 0; y < old.height; y++) {
            const ny = y + dy;
            if (ny < 0 || ny >= height) continue;
            for (let x = 0; x < Math.min(width, old.width); x++) {
              next[ny * width + x] = pixels[y * old.width + x]!;
            }
          }
          return next;
        });
      }
      const oldCols = old.width / TILE_SIZE;
      const oldRows = old.height / TILE_SIZE;
      const footprint = Array<number>(tilesW * tilesH).fill(0);
      for (let row = 0; row < oldRows; row++) {
        const nr = row + (tilesH - oldRows);
        if (nr < 0 || nr >= tilesH) continue;
        for (let col = 0; col < Math.min(tilesW, oldCols); col++) {
          footprint[nr * tilesW + col] = old.footprint[row * oldCols + col] ?? 0;
        }
      }
      doc.width = width;
      doc.height = height;
      doc.footprint = footprint;
    });
  }

  /**
   * 캐릭터 해상도 바꾸기 (가로 px, 세로는 2배). 그림은 발밑 가운데를 기준으로 남긴다.
   * 확대·축소해서 다시 칠하지 않으므로, 넓히면 그림이 아래 가운데에 그대로 남고 좁히면 가장자리가 잘린다.
   */
  resizeCharacter(width: number): void {
    const height = characterHeightOf(width);
    const old = this.doc;
    if (old.kind !== 'character' || (width === old.width && height === old.height)) return;
    const dx = Math.floor((width - old.width) / 2);
    const dy = height - old.height;
    this.edit((doc) => {
      for (const animation of doc.animations) {
        animation.frames = animation.frames.map((pixels) => {
          const next = blank(width, height);
          for (let y = 0; y < old.height; y++) {
            const ny = y + dy;
            if (ny < 0 || ny >= height) continue;
            for (let x = 0; x < old.width; x++) {
              const nx = x + dx;
              if (nx < 0 || nx >= width) continue;
              next[ny * width + nx] = pixels[y * old.width + x]!;
            }
          }
          return next;
        });
      }
      doc.width = width;
      doc.height = height;
    });
  }

  /**
   * 캐릭터의 발 아래 빈 줄 정리. 광장은 그림의 맨 아래를 발밑으로 보고 세우므로, 발 아래가 비어 있으면
   * 캐릭터가 떠 보인다. 모든 프레임에 공통으로 비어 있는 줄 수만큼 그림 전체를 내린다
   * (걷기의 들썩임처럼 프레임끼리의 높이 차이는 그대로). 내린 줄 수를 돌려준다.
   */
  trimBelowFeet(): number {
    const { kind, width, height } = this.doc;
    if (kind !== 'character') return 0;
    let rows = height;
    for (const animation of this.doc.animations) {
      for (const pixels of animation.frames) {
        const empty = emptyRowsBelow(pixels, width, height);
        // 빈 프레임은 세지 않는다 (아직 그리지 않은 프레임)
        if (empty < height) rows = Math.min(rows, empty);
      }
    }
    if (rows === 0 || rows === height) return 0;
    this.edit((doc) => {
      for (const animation of doc.animations) {
        animation.frames = animation.frames.map((pixels) =>
          shiftPixels(pixels, width, height, 0, rows),
        );
      }
    });
    return rows;
  }

  /**
   * 사각형만 남기고 나머지를 지운다. frame을 주면 그 프레임만, 없으면 모든 프레임.
   * fit이면(모든 프레임일 때만) 그림 크기도 사각형에 맞춘다: 캐릭터는 가로 = max(사각형 가로, 세로/2)로
   * 발밑 가운데에, 오브젝트는 16px 단위로 올려 왼쪽 아래에 놓는다 (맵에 놓는 기준과 같게).
   */
  crop(rect: Rect, frame?: FrameRef, fit = false): void {
    const old = this.doc;
    let width = old.width;
    let height = old.height;
    let at = { x: rect.x, y: rect.y };
    if (fit && !frame) {
      if (old.kind === 'character') {
        width = Math.min(
          CHARACTER_MAX_WIDTH,
          Math.max(CHARACTER_MIN_WIDTH, rect.w, Math.ceil(rect.h / 2)),
        );
        height = characterHeightOf(width);
        at = { x: Math.floor((width - rect.w) / 2), y: height - rect.h };
      } else if (old.kind === 'object') {
        width = Math.ceil(rect.w / TILE_SIZE) * TILE_SIZE;
        height = Math.ceil(rect.h / TILE_SIZE) * TILE_SIZE;
        at = { x: 0, y: height - rect.h };
      }
    }
    const cut = (pixels: Uint8Array) => {
      const next = blank(width, height);
      for (let y = 0; y < rect.h; y++) {
        for (let x = 0; x < rect.w; x++) {
          const v = pixels[(rect.y + y) * old.width + rect.x + x] ?? 0;
          const tx = at.x + x;
          const ty = at.y + y;
          if (tx < width && ty < height) next[ty * width + tx] = v;
        }
      }
      return next;
    };
    this.edit((doc) => {
      doc.animations.forEach((animation, a) => {
        animation.frames = animation.frames.map((pixels, f) =>
          !frame || (frame.animation === a && frame.frame === f) ? cut(pixels) : pixels,
        );
      });
      if (width !== old.width || height !== old.height) {
        doc.width = width;
        doc.height = height;
        if (doc.kind === 'object') doc.footprint = defaultFootprint(width, height);
      }
    });
  }

  /** 가져온 프레임들로 지금 프레임부터 덮어쓴다 (모자라면 프레임을 더한다) */
  importFrames(ref: FrameRef, frames: Uint8Array[], palette: string[]): void {
    this.edit((doc) => {
      doc.palette = palette;
      const list = doc.animations[ref.animation]!.frames;
      frames.forEach((pixels, i) => {
        const at = ref.frame + i;
        if (at < list.length) list[at] = pixels;
        else list.push(pixels);
      });
    });
  }
}
