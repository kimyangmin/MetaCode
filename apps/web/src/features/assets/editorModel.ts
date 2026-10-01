import {
  type AssetKind,
  type AssetManifest,
  CHARACTER_DEFAULT_SIZE,
  CHARACTER_MAX_SIZE,
  CHARACTER_MIN_SIZE,
  DEFAULT_ANIMATION,
  FRAME_LIMIT,
  JUMP_ANIMATIONS,
  MOTION_KEYS,
  type MotionKey,
  PALETTE_MAX_COLORS,
  REQUIRED_CHARACTER_ANIMATIONS,
  type RequiredAnimation,
  TILE_SIZE,
  decodePixels,
  encodePixels,
  isBlank,
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
  /** 캐릭터 모션(광장에서 숫자 키로 트는 것)이면 키, 이름, 반복 */
  key?: MotionKey;
  label?: string;
  loop?: boolean;
}

/** 필수 애니메이션 (지울 수 없다) */
const REQUIRED_NAMES = new Set(REQUIRED_CHARACTER_ANIMATIONS.map((r) => r.name));
/** 한 캐릭터에 둘 수 있는 애니메이션 수 (매니페스트 검증과 같게) */
const ANIMATION_LIMIT = 32;

export const isMotion = (animation: EditorAnimation) => animation.key !== undefined;

export interface EditorDoc {
  kind: AssetKind;
  name: string;
  width: number;
  height: number;
  /** 픽셀 값 v(1 이상) = palette[v - 1], 0 = 투명 */
  palette: string[];
  animations: EditorAnimation[];
  solid: boolean;
  /** 타일: 횡스크롤의 발판 (위에서만 딛는다) */
  platform: boolean;
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
      ? CHARACTER_DEFAULT_SIZE.width
      : kind === 'tile'
        ? TILE_SIZE
        : tiles.w * TILE_SIZE;
  const height =
    kind === 'character'
      ? CHARACTER_DEFAULT_SIZE.height
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
    platform: false,
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
      ...(animation?.key !== undefined
        ? { key: animation.key, label: animation.label, loop: animation.loop ?? false }
        : {}),
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
    platform: manifest.platform ?? false,
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
      ...(animation.key !== undefined
        ? {
            key: animation.key,
            label: animation.label?.trim() || animation.name,
            ...(animation.loop ? { loop: true } : {}),
          }
        : {}),
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
    ...(doc.kind === 'tile' && doc.platform && !doc.solid ? { platform: true } : {}),
    ...(doc.kind === 'object' ? { footprint: doc.footprint.map((v) => (v ? 1 : 0) as 0 | 1) } : {}),
    ...(doc.kind === 'character' && doc.colorSlots ? { colorSlots: doc.colorSlots } : {}),
  };
}

/**
 * 되돌리기용 사본. 프레임 픽셀(Uint8Array)은 복사하지 않고 함께 쓴다: 큰 캐릭터(512×512)는 프레임 한 장이
 * 256KB라, 붓질마다 문서 전체를 복사하면 되돌리기 기록만으로 수백 MB가 됐다. 대신 프레임을 그 자리에서
 * 고치기 전에 PixelDocument.writable()이 그 프레임만 복사한다 (copy-on-write).
 */
function snapshot(doc: EditorDoc): EditorDoc {
  return {
    ...doc,
    palette: [...doc.palette],
    animations: doc.animations.map((a) => ({ ...a, frames: [...a.frames] })),
    footprint: [...doc.footprint],
  };
}

/** 프레임 픽셀의 지문 (같은 그림 찾기). 같으면 바이트까지 비교한다 */
function fingerprint(pixels: Uint8Array): number {
  let h = 2166136261;
  for (let i = 0; i < pixels.length; i++) {
    h ^= pixels[i]!;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function samePixels(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
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
  /** 마지막 begin() 뒤에 복사해서 이 문서만 가진 프레임. 이것만 그 자리에서 고쳐도 된다 */
  private owned = new WeakSet<Uint8Array>();
  /** 프레임 수 세기는 문서가 바뀔 때만 다시 한다 (화면이 그릴 때마다 부른다) */
  private counted: { version: number; count: number } | null = null;

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
    this.undoStack.push(snapshot(this.doc));
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    // 지금 프레임은 모두 방금 만든 사본과 함께 쓰므로, 고치려면 다시 복사해야 한다.
    this.owned = new WeakSet();
  }

  undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(this.doc);
    this.doc = previous;
    this.owned = new WeakSet();
    this.changed();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.doc);
    this.doc = next;
    this.owned = new WeakSet();
    this.changed();
  }

  /** 그 자리에서 고칠 프레임. 되돌리기 기록과 함께 쓰는 프레임이면 먼저 복사해서 바꿔 끼운다 */
  private writable(ref: FrameRef): Uint8Array | undefined {
    const frames = this.doc.animations[ref.animation]?.frames;
    const pixels = frames?.[ref.frame];
    if (!frames || !pixels) return undefined;
    if (this.owned.has(pixels)) return pixels;
    const copy = Uint8Array.from(pixels);
    frames[ref.frame] = copy;
    this.owned.add(copy);
    return copy;
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
    const current = this.frame(ref);
    const { width, height } = this.doc;
    if (!current) return;
    const targets = (mirror ? [x, width - 1 - x] : [x]).filter(
      (px) => px >= 0 && y >= 0 && px < width && y < height && current[y * width + px] !== value,
    );
    if (targets.length === 0) return;
    const pixels = this.writable(ref)!;
    let touched = false;
    for (const px of targets) {
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
    const current = this.frame(ref);
    const { width, height } = this.doc;
    if (!current || x < 0 || y < 0 || x >= width || y >= height) return;
    const target = current[y * width + x];
    if (target === value) return;
    this.begin();
    const pixels = this.writable(ref)!;
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

  // ── 캐릭터 모션 (숫자 키), 점프 ──

  /** 아직 쓰지 않은 모션 키 (1, 2, …, 9, 0 순서) */
  freeMotionKeys(except?: MotionKey): MotionKey[] {
    const used = new Set(this.doc.animations.map((a) => a.key).filter((k) => k && k !== except));
    return MOTION_KEYS.filter((key) => !used.has(key));
  }

  canAddAnimation(): boolean {
    return this.doc.kind === 'character' && this.doc.animations.length < ANIMATION_LIMIT;
  }

  /**
   * 모션을 하나 더하고 그 번호를 돌려준다. 남은 키 중 첫 번째를 주고, 대기(아래) 첫 프레임을 복사해 시작한다.
   * 키가 다 찼거나 더할 수 없으면 null.
   */
  addMotion(): number | null {
    const key = this.freeMotionKeys()[0];
    if (!key || !this.canAddAnimation()) return null;
    let n = 1;
    while (this.doc.animations.some((a) => a.name === `motion-${n}`)) n++;
    const idle = this.doc.animations.find((a) => a.name === 'idle-down')?.frames[0];
    this.edit((doc) => {
      doc.animations.push({
        name: `motion-${n}`,
        frames: [idle ? Uint8Array.from(idle) : blank(doc.width, doc.height)],
        frameMs: 150,
        key,
        label: `모션 ${n}`,
        loop: false,
      });
    });
    return this.doc.animations.length - 1;
  }

  /** 모션의 이름·키·반복을 바꾼다. 다른 모션이 쓰는 키는 고를 수 없다 */
  updateMotion(index: number, change: { label?: string; key?: MotionKey; loop?: boolean }): void {
    const animation = this.doc.animations[index];
    if (!animation || !isMotion(animation)) return;
    if (change.key && !this.freeMotionKeys(animation.key).includes(change.key)) return;
    this.edit(
      (doc) => Object.assign(doc.animations[index]!, change),
      change.label !== undefined ? `motion-label:${index}` : undefined,
    );
  }

  /** 필수가 아닌 애니메이션(모션, 점프)을 지운다 */
  removeAnimation(index: number): void {
    const animation = this.doc.animations[index];
    if (!animation || REQUIRED_NAMES.has(animation.name)) return;
    this.edit((doc) => doc.animations.splice(index, 1));
  }

  /** 횡스크롤 점프 애니메이션이 모두 있는지 */
  hasJump(): boolean {
    return JUMP_ANIMATIONS.every((name) => this.doc.animations.some((a) => a.name === name));
  }

  /**
   * 횡스크롤에서 공중에 있을 때 틀 점프 애니메이션(왼쪽, 오른쪽)을 더한다. 걷기의 두 번째 프레임을 복사해
   * 시작한다 (없을 때 광장이 쓰는 모습과 같다). 더한 첫 애니메이션의 번호, 더할 수 없으면 null.
   */
  addJump(): number | null {
    const missing = JUMP_ANIMATIONS.filter((n) => !this.doc.animations.some((a) => a.name === n));
    if (missing.length === 0 || this.doc.animations.length + missing.length > ANIMATION_LIMIT) {
      return null;
    }
    const first = this.doc.animations.length;
    this.edit((doc) => {
      for (const name of missing) {
        const walk = doc.animations.find((a) => a.name === name.replace('jump-', 'walk-'));
        const source = walk?.frames[Math.min(1, walk.frames.length - 1)];
        doc.animations.push({
          name,
          frames: [source ? Uint8Array.from(source) : blank(doc.width, doc.height)],
          frameMs: 150,
        });
      }
    });
    return first;
  }

  setFrameMs(animation: number, frameMs: number): void {
    this.edit((doc) => {
      doc.animations[animation]!.frameMs = frameMs;
    });
  }

  /**
   * 저장할 때의 프레임 수 (같은 그림은 하나로 센다). 예전엔 프레임마다 base64로 바꿔 비교해서
   * 큰 캐릭터는 그릴 때마다 느려졌다. 지문으로 묶고 바이트를 비교하며, 문서가 바뀔 때만 다시 센다.
   */
  frameCount(): number {
    if (this.counted?.version === this.version) return this.counted.count;
    const groups = new Map<number, Uint8Array[]>();
    let count = 0;
    for (const a of this.doc.animations) {
      for (const f of a.frames) {
        const key = fingerprint(f);
        const group = groups.get(key);
        if (group?.some((other) => other === f || samePixels(other, f))) continue;
        if (group) group.push(f);
        else groups.set(key, [f]);
        count++;
      }
    }
    this.counted = { version: this.version, count };
    return count;
  }

  /**
   * 캐릭터에 빠진 필수 애니메이션 (매니페스트의 missingAnimations와 같은 규칙). 매니페스트로 바꾸지 않고
   * 프레임을 바로 본다 (화면이 그릴 때마다 부르므로).
   */
  missingAnimations(): RequiredAnimation[] {
    if (this.doc.kind !== 'character') return [];
    return REQUIRED_CHARACTER_ANIMATIONS.filter((required) => {
      const animation = this.doc.animations.find((a) => a.name === required.name);
      if (!animation || animation.frames.length < required.minFrames) return true;
      return animation.frames.some((pixels) => isBlank(pixels));
    });
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
        // 되돌리기 기록과 함께 쓰는 프레임이라 그 자리에서 고치지 않고 새로 만든다.
        animation.frames = animation.frames.map((pixels) =>
          pixels.map((v) => (v === value ? 0 : v > value ? v - 1 : v)),
        );
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

  /** 지나갈 수 없음과 발판은 함께 쓸 수 없다 (하나를 켜면 다른 하나는 꺼진다) */
  setSolid(solid: boolean): void {
    this.edit((doc) => {
      doc.solid = solid;
      if (solid) doc.platform = false;
    });
  }

  setPlatform(platform: boolean): void {
    this.edit((doc) => {
      doc.platform = platform;
      if (platform) doc.solid = false;
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
   * 캐릭터 해상도 바꾸기 (가로·세로 px, 각각 16~512). 그림은 발밑 가운데를 기준으로 남긴다.
   * 확대·축소해서 다시 칠하지 않으므로, 넓히면 그림이 아래 가운데에 그대로 남고 좁히면 가장자리가 잘린다.
   */
  resizeCharacter(width: number, height: number): void {
    const old = this.doc;
    const ok = (v: number) =>
      Number.isInteger(v) && v >= CHARACTER_MIN_SIZE && v <= CHARACTER_MAX_SIZE;
    if (old.kind !== 'character' || !ok(width) || !ok(height)) return;
    if (width === old.width && height === old.height) return;
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
   * 캐릭터가 떠 보인다. 애니메이션마다 그 안의 프레임에 공통으로 비어 있는 줄 수만큼 내린다: 걷기의
   * 들썩임처럼 한 애니메이션 안의 높이 차이는 남기고, 다른 애니메이션(예: 걷기에서 발이 바닥에 닿은
   * 프레임)이 막지 않는다. 빈 프레임(아직 안 그림)은 세지 않는다.
   * 정리한 애니메이션 수와 가장 많이 내린 줄 수를 돌려준다.
   */
  trimBelowFeet(): { animations: number; rows: number } {
    const { kind, width, height } = this.doc;
    const none = { animations: 0, rows: 0 };
    if (kind !== 'character') return none;
    const shifts = this.doc.animations.map((animation) => {
      let rows = height;
      for (const pixels of animation.frames) {
        const empty = emptyRowsBelow(pixels, width, height);
        if (empty < height) rows = Math.min(rows, empty);
      }
      return rows === height ? 0 : rows;
    });
    if (shifts.every((rows) => rows === 0)) return none;
    this.edit((doc) => {
      doc.animations.forEach((animation, i) => {
        const rows = shifts[i]!;
        if (rows > 0) {
          animation.frames = animation.frames.map((pixels) =>
            shiftPixels(pixels, width, height, 0, rows),
          );
        }
      });
    });
    return {
      animations: shifts.filter((rows) => rows > 0).length,
      rows: Math.max(...shifts),
    };
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
        const clamp = (v: number) => Math.min(CHARACTER_MAX_SIZE, Math.max(CHARACTER_MIN_SIZE, v));
        width = clamp(rect.w);
        height = clamp(rect.h);
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
