import {
  type Animator,
  type AssetKind,
  type AssetManifest,
  CHARACTER_DEFAULT_SIZE,
  CHARACTER_PLAZA_HEIGHT_DEFAULT,
  CHARACTER_MAX_SIZE,
  CHARACTER_MIN_SIZE,
  DEFAULT_ANIMATION,
  EMOTE_ANIMATION,
  FRAME_LIMIT,
  JUMP_ANIMATIONS,
  type MotionKey,
  SUGGESTED_KEYS,
  isAssignableKey,
  PALETTE_MAX_COLORS,
  PlazaStyle,
  REQUIRED_CHARACTER_ANIMATIONS,
  type RequiredAnimation,
  TILE_SIZE,
  characterStyle,
  decodeFrame,
  encodeFrame,
  isBlank,
} from '@metacode/shared';
import { type Rect, emptyRowsBelow, shiftPixels } from './selection';

/**
 * 도트 에디터가 고치는 문서. 매니페스트는 애니메이션이 프레임을 번호로 함께 쓰지만(같은 그림 한 번만 저장),
 * 에디터에서는 애니메이션마다 자기 프레임을 가진다. 저장할 때 같은 그림을 합친다 (toManifest).
 */
export interface EditorAnimation {
  name: string;
  frames: Uint16Array[];
  frameMs: number;
  /** 캐릭터 모션(광장에서 키로 트는 것)이면 키, 이름, 반복 */
  key?: MotionKey;
  label?: string;
  loop?: boolean;
}

/** 이 문서(캐릭터)에 필요한 애니메이션 (지울 수 없다). 광장 방식마다 다르고, 캐릭터가 아니면 없다 */
export function requiredOf(doc: Pick<EditorDoc, 'kind' | 'style'>): readonly RequiredAnimation[] {
  return doc.kind === 'character' ? REQUIRED_CHARACTER_ANIMATIONS[doc.style] : [];
}
/** 한 캐릭터에 둘 수 있는 애니메이션 수 (매니페스트 검증과 같게) */
export const ANIMATION_LIMIT = 32;

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
  /** 캐릭터가 쓰는 광장 방식 (필수 애니메이션이 다름). 캐릭터가 아니면 의미 없음 */
  style: PlazaStyle;
  /** 캐릭터: 광장에서의 세로 크기 (타일) */
  plazaHeight: number;
  /** 캐릭터: 애니메이터 (없으면 정해진 규칙대로 튼다). 고칠 때는 통째로 바꾼다 (되돌리기가 사본을 함께 씀) */
  animator?: Animator;
}

/** 붓 굵기 (정사각형 한 변, px) */
export const BRUSH_MIN = 1;
export const BRUSH_MAX = 32;

/** (x, y)를 가운데로 하는 굵기 size의 붓이 칠하는 칸들 (짝수 굵기는 왼쪽 위로 한 칸 더) */
export function brushCells(x: number, y: number, size: number): { x: number; y: number }[] {
  const n = Math.max(BRUSH_MIN, Math.min(BRUSH_MAX, Math.round(size)));
  const start = -Math.floor((n - 1) / 2);
  const cells: { x: number; y: number }[] = [];
  for (let dy = 0; dy < n; dy++) {
    for (let dx = 0; dx < n; dx++) cells.push({ x: x + start + dx, y: y + start + dy });
  }
  return cells;
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

const blank = (width: number, height: number) => new Uint16Array(width * height);

/**
 * 파일 이름 등에서 애니메이션 이름(영문 소문자로 시작, 소문자·숫자·-, 32자까지)을 만든다.
 * 쓸 글자가 없으면(한글 이름 등) `anim`.
 */
export function animationNameFrom(text: string): string {
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/-+$/, '')
    .slice(0, 24)
    .replace(/-+$/, '');
  return cleaned || 'anim';
}

/**
 * 새 모션·첨부 모션을 시작할 그림: 그 광장 방식의 대기 첫 프레임 (탑다운은 아래, 횡스크롤은 오른쪽).
 * 예전엔 횡스크롤 캐릭터도 아래 대기를 먼저 찾아서, 탑다운에서 바꾸며 남은 빈 아래 대기를 복사했다.
 */
function idleFrame(doc: Pick<EditorDoc, 'animations' | 'style'>): Uint16Array | undefined {
  const preferred = doc.style === PlazaStyle.SideScroll ? 'idle-right' : 'idle-down';
  const idle =
    doc.animations.find((a) => a.name === preferred && !a.frames.every(isBlank)) ??
    doc.animations.find((a) => a.name.startsWith('idle-') && !a.frames.every(isBlank));
  return idle?.frames[0];
}

/** 캐릭터 해상도를 이 크기로 바꿀 수 있는지 (16~512px 정수이고 지금과 다를 때) */
function canResizeCharacter(doc: EditorDoc, width: number, height: number): boolean {
  const ok = (v: number) =>
    Number.isInteger(v) && v >= CHARACTER_MIN_SIZE && v <= CHARACTER_MAX_SIZE;
  return (
    doc.kind === 'character' &&
    ok(width) &&
    ok(height) &&
    (width !== doc.width || height !== doc.height)
  );
}

/** 그림이 있는 칸을 감싸는 범위 (빈 프레임이면 null) */
function drawnBox(
  pixels: Uint16Array,
  width: number,
  height: number,
): { top: number; left: number; right: number } | null {
  let top = -1;
  let left = width;
  let right = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!pixels[y * width + x]) continue;
      if (top === -1) top = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  return top === -1 ? null : { top, left, right };
}

/** 캐릭터 해상도를 그 자리에서 바꾼다 (edit() 안에서 부른다). 그림은 발밑 가운데를 기준으로 남긴다 */
function resizeCharacterDoc(doc: EditorDoc, width: number, height: number): void {
  const old = { width: doc.width, height: doc.height };
  const dx = Math.floor((width - old.width) / 2);
  const dy = height - old.height;
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
}

/** 모션(애니메이션)과 애니메이터 파라미터가 쓰고 있는 키 (숫자, 파라미터의 글자 키) */
export function usedMotionKeys(doc: Pick<EditorDoc, 'animations' | 'animator'>): Set<string> {
  const used = new Set<string>();
  for (const a of doc.animations) if (a.key) used.add(a.key);
  for (const p of doc.animator?.parameters ?? []) if (p.key) used.add(p.key);
  return used;
}

/** 쓰지 않은 이름 (name, name-2, name-3 …) */
export function freeAnimationName(name: string, used: ReadonlySet<string>): string {
  if (!used.has(name)) return name;
  let n = 2;
  while (used.has(`${name}-${n}`)) n++;
  return `${name}-${n}`;
}

/** 오브젝트의 기본 막힌 칸: 아래 줄만 (위쪽은 캐릭터가 뒤로 지나갈 수 있게) */
function defaultFootprint(width: number, height: number): number[] {
  const cols = Math.round(width / TILE_SIZE);
  const cells = cols * Math.round(height / TILE_SIZE);
  return Array.from({ length: cells }, (_, i) => (i >= cells - cols ? 1 : 0));
}

/** 필수 애니메이션 하나를 빈 프레임으로 */
function blankRequired(
  required: RequiredAnimation,
  width: number,
  height: number,
): EditorAnimation {
  return {
    name: required.name,
    frames: Array.from({ length: required.minFrames }, () => blank(width, height)),
    frameMs: required.name.startsWith('idle') ? 1000 : required.name.startsWith('jump') ? 150 : 120,
  };
}

/** 종류에 맞는 새 문서. 캐릭터는 그 광장 방식의 필수 애니메이션을 빈 프레임으로 채워 둔다 */
export function newDoc(
  kind: AssetKind,
  name: string,
  tiles = { w: 1, h: 1 },
  style: PlazaStyle = PlazaStyle.TopDown,
): EditorDoc {
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
      ? REQUIRED_CHARACTER_ANIMATIONS[style].map((required) =>
          blankRequired(required, width, height),
        )
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
    style,
    plazaHeight: CHARACTER_PLAZA_HEIGHT_DEFAULT,
  };
}

export function fromManifest(manifest: AssetManifest): EditorDoc {
  const frames = manifest.frames.map(
    (f) => decodeFrame(f) ?? blank(manifest.width, manifest.height),
  );
  const style = characterStyle(manifest);
  const required = REQUIRED_CHARACTER_ANIMATIONS[style];
  const order =
    manifest.kind === 'character'
      ? [
          ...required.map((r) => r.name),
          ...Object.keys(manifest.animations).filter(
            (name) => !required.some((r) => r.name === name),
          ),
        ]
      : Object.keys(manifest.animations);
  const animations = order.map((name) => {
    const animation = manifest.animations[name];
    return {
      name,
      frames: animation
        ? animation.frames.map((i) =>
            Uint16Array.from(frames[i] ?? blank(manifest.width, manifest.height)),
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
    style,
    plazaHeight: manifest.plazaHeight ?? CHARACTER_PLAZA_HEIGHT_DEFAULT,
    ...(manifest.animator ? { animator: manifest.animator } : {}),
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
        const encoded = encodeFrame(pixels);
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
    // 탑다운(기본)은 적지 않는다: 방식을 고르기 전에 만든 캐릭터와 같은 매니페스트가 된다.
    ...(doc.kind === 'character' && doc.style === PlazaStyle.SideScroll
      ? { style: doc.style }
      : {}),
    // 기본 크기도 적지 않는다 (크기를 고르기 전에 만든 캐릭터와 같게)
    ...(doc.kind === 'character' && doc.plazaHeight !== CHARACTER_PLAZA_HEIGHT_DEFAULT
      ? { plazaHeight: doc.plazaHeight }
      : {}),
    ...(doc.kind === 'character' && doc.animator ? { animator: doc.animator } : {}),
  };
}

/**
 * 되돌리기용 사본. 프레임 픽셀(Uint16Array)은 복사하지 않고 함께 쓴다: 큰 캐릭터(512×512)는 프레임 한 장이
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
function fingerprint(pixels: Uint16Array): number {
  let h = 2166136261;
  for (let i = 0; i < pixels.length; i++) {
    h ^= pixels[i]!;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function samePixels(a: Uint16Array, b: Uint16Array): boolean {
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
  /** beginStroke() 뒤 아직 아무것도 칠하지 않았다: 처음 실제로 바꿀 때 begin()한다 */
  private strokePending = false;
  /** 마지막 begin() 뒤에 복사해서 이 문서만 가진 프레임. 이것만 그 자리에서 고쳐도 된다 */
  private owned = new WeakSet<Uint16Array>();
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

  /**
   * 저장한 것으로 표시한다. version을 주면 그 버전을 저장한 것으로 본다: 저장 요청을 기다리는 동안 더 고쳤으면
   * 그 변경은 아직 저장하지 않은 것으로 남는다 (예전엔 끝난 시점의 버전을 저장한 것으로 봐서, 닫을 때 묻지
   * 않고 그 변경을 잃었다).
   */
  markSaved(version = this.version): void {
    this.savedVersion = version;
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
    this.strokePending = false;
    this.undoStack.push(snapshot(this.doc));
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    // 지금 프레임은 모두 방금 만든 사본과 함께 쓰므로, 고치려면 다시 복사해야 한다.
    this.owned = new WeakSet();
  }

  /**
   * 붓질 한 번을 시작한다. begin()과 같지만 실제로 칠할 때 단계를 만든다: 같은 색 위를 눌러 아무것도 바뀌지
   * 않으면 빈 되돌리기 단계가 생기지 않고, 다시 하기 기록도 지워지지 않는다.
   */
  beginStroke(): void {
    this.lastKey = null;
    this.strokePending = true;
  }

  undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(this.doc);
    this.doc = previous;
    this.resetEditState();
    this.changed();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.doc);
    this.doc = next;
    this.resetEditState();
    this.changed();
  }

  /**
   * 되돌리기·다시 하기 뒤: 묶음 키도 잊는다. 예전엔 색 고르기를 끌고 되돌린 뒤 같은 색을 다시 고르면 앞의 묶음에
   * 이어 붙어서 되돌리기 단계 없이 바뀌었다 (애니메이터의 상태 끌기·이름 입력도 같음).
   */
  private resetEditState(): void {
    this.owned = new WeakSet();
    this.lastKey = null;
    this.strokePending = false;
  }

  /** 그 자리에서 고칠 프레임. 되돌리기 기록과 함께 쓰는 프레임이면 먼저 복사해서 바꿔 끼운다 */
  private writable(ref: FrameRef): Uint16Array | undefined {
    const frames = this.doc.animations[ref.animation]?.frames;
    const pixels = frames?.[ref.frame];
    if (!frames || !pixels) return undefined;
    if (this.owned.has(pixels)) return pixels;
    const copy = Uint16Array.from(pixels);
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

  frame(ref: FrameRef): Uint16Array | undefined {
    return this.doc.animations[ref.animation]?.frames[ref.frame];
  }

  /** 프레임 한 장을 통째로 바꾼다 (begin() 다음에 부른다. 선택 영역 옮기기처럼 매번 처음부터 다시 만들 때) */
  setFrame(ref: FrameRef, pixels: Uint16Array): void {
    const frames = this.doc.animations[ref.animation]?.frames;
    if (!frames || ref.frame >= frames.length) return;
    frames[ref.frame] = pixels;
    this.changed();
  }

  pick(ref: FrameRef, x: number, y: number): number {
    return this.frame(ref)?.[y * this.doc.width + x] ?? 0;
  }

  /**
   * 붓 한 번 (begin() 다음에 여러 번 부른다). size는 붓 굵기(정사각형 한 변)이고, mirror면 좌우 대칭 자리에도
   * 칠한다.
   */
  paint(ref: FrameRef, x: number, y: number, value: number, mirror = false, size = 1): void {
    const current = this.frame(ref);
    const { width, height } = this.doc;
    if (!current) return;
    const cells = brushCells(x, y, size);
    const targets = (
      mirror ? [...cells, ...cells.map((c) => ({ ...c, x: width - 1 - c.x }))] : cells
    )
      .filter((c) => c.x >= 0 && c.y >= 0 && c.x < width && c.y < height)
      .map((c) => c.y * width + c.x)
      .filter((i) => current[i] !== value);
    if (targets.length === 0) return;
    if (this.strokePending) this.begin();
    const pixels = this.writable(ref)!;
    for (const i of targets) pixels[i] = value;
    this.changed();
  }

  /** 선: 마우스를 빨리 움직여도 점이 끊기지 않게 두 점 사이를 잇는다 (브레젠험) */
  line(
    ref: FrameRef,
    from: { x: number; y: number },
    to: { x: number; y: number },
    value: number,
    mirror = false,
    size = 1,
  ) {
    let { x, y } = from;
    const dx = Math.abs(to.x - x);
    const dy = -Math.abs(to.y - y);
    const sx = x < to.x ? 1 : -1;
    const sy = y < to.y ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.paint(ref, x, y, value, mirror, size);
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
      const pixels = copy && source ? Uint16Array.from(source) : blank(doc.width, doc.height);
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

  // ── 캐릭터 모션 (키), 점프 ──

  /**
   * 새 모션에 처음 붙여 줄 수 있는 키 (`SUGGESTED_KEYS` 순서, 1·2·…·0·Z·X…). 애니메이터의 직접 만든 파라미터에
   * 단 키도 쓴 것으로 본다 (예전엔 빠져 있어서 모션을 더하면 파라미터와 같은 키가 붙어 저장이 막혔다).
   * 키는 에디터에서 아무 키나 눌러 바꿀 수 있다 (`keyTaken`).
   */
  freeMotionKeys(except?: MotionKey): MotionKey[] {
    const used = usedMotionKeys(this.doc);
    if (except) used.delete(except);
    return SUGGESTED_KEYS.filter((key) => !used.has(key));
  }

  /** 그 키를 이미 모션이나 애니메이터 파라미터가 쓰는지 (except는 빼고 센다) */
  keyTaken(key: string, except?: string): boolean {
    return key !== except && usedMotionKeys(this.doc).has(key);
  }

  canAddAnimation(): boolean {
    return this.doc.kind === 'character' && this.doc.animations.length < ANIMATION_LIMIT;
  }

  /**
   * 모션을 하나 더하고 그 번호를 돌려준다. 남은 키 중 첫 번째를 주고, 대기(아래, 횡스크롤용은 오른쪽)
   * 첫 프레임을 복사해 시작한다.
   * 키가 다 찼거나 더할 수 없으면 null.
   */
  addMotion(): number | null {
    const key = this.freeMotionKeys()[0];
    if (!key || !this.canAddAnimation()) return null;
    let n = 1;
    while (this.doc.animations.some((a) => a.name === `motion-${n}`)) n++;
    const idle = idleFrame(this.doc);
    this.edit((doc) => {
      doc.animations.push({
        name: `motion-${n}`,
        frames: [idle ? Uint16Array.from(idle) : blank(doc.width, doc.height)],
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
    if (change.key && (!isAssignableKey(change.key) || this.keyTaken(change.key, animation.key))) {
      return;
    }
    this.edit(
      (doc) => Object.assign(doc.animations[index]!, change),
      change.label !== undefined ? `motion-label:${index}` : undefined,
    );
  }

  /** 필수가 아닌 애니메이션(모션, 점프)을 지운다 */
  removeAnimation(index: number): void {
    const animation = this.doc.animations[index];
    if (!animation || requiredOf(this.doc).some((r) => r.name === animation.name)) return;
    this.edit((doc) => doc.animations.splice(index, 1));
  }

  /** 첨부 모션이 있는지 */
  hasEmote(): boolean {
    return this.doc.animations.some((a) => a.name === EMOTE_ANIMATION.name);
  }

  /**
   * 첨부 모션(첨부 메시지를 보냈을 때 한 번 트는 애니메이션)을 더한다. 필수가 아니라서 새 캐릭터에는 없다
   * (없으면 광장에서 제자리에서 뛰기만 한다). 대기의 첫 프레임을 복사해 시작한다. 더한 번호, 못 더하면 null.
   */
  addEmote(): number | null {
    if (this.hasEmote() || !this.canAddAnimation()) return null;
    const at = this.doc.animations.length;
    this.edit((doc) => {
      const source = idleFrame(doc);
      doc.animations.push({
        name: EMOTE_ANIMATION.name,
        frames: [source ? Uint16Array.from(source) : blank(doc.width, doc.height)],
        frameMs: 150,
      });
    });
    return at;
  }

  /** 횡스크롤 점프 애니메이션(왼쪽·오른쪽)이 모두 있는지 */
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
          frames: [source ? Uint16Array.from(source) : blank(doc.width, doc.height)],
          frameMs: 150,
        });
      }
    });
    return first;
  }

  /**
   * 가져온 그림(GIF)들로 애니메이션을 한 번에 채운다 (되돌리기 한 단계). target이 번호면 그 애니메이션의
   * 프레임을 바꾸고, motion이면 남은 키로 새 모션을 만들고, animation이면 키 없는 새 애니메이션을
   * 만든다 (애니메이터의 상태가 틀 것: 이름은 파일 이름에서, 겹치면 -2, -3 …). mirror면 왼쪽·오른쪽
   * 애니메이션의 반대쪽도 좌우 반전한 그림으로 채운다. 채운 첫 애니메이션의 번호를 돌려준다 (없으면 null).
   * size를 주면(캐릭터에 그림이 들어가게 해상도를 넓힐 때) 같은 되돌리기 단계에서 먼저 해상도를 바꾼다
   * (예전엔 해상도와 가져오기가 따로라 되돌리기를 두 번 눌러야 했다). frames는 그 크기로 만든 것이다.
   */
  importAnimations(
    entries: {
      target: number | { motion: string } | { animation: string };
      frames: Uint16Array[];
      frameMs: number;
      mirror: boolean;
    }[],
    palette: string[],
    mirrorOf: (pixels: Uint16Array) => Uint16Array,
    size?: { width: number; height: number },
  ): number | null {
    let first: number | null = null;
    const resize = size && canResizeCharacter(this.doc, size.width, size.height) ? size : null;
    this.edit((doc) => {
      if (resize) resizeCharacterDoc(doc, resize.width, resize.height);
      doc.palette = palette;
      for (const entry of entries) {
        let index: number;
        if (typeof entry.target === 'number') {
          index = entry.target;
          const animation = doc.animations[index];
          if (!animation) continue;
          animation.frames = entry.frames;
          animation.frameMs = entry.frameMs;
        } else if ('animation' in entry.target) {
          if (doc.kind !== 'character' || doc.animations.length >= ANIMATION_LIMIT) continue;
          const used = new Set(doc.animations.map((a) => a.name));
          index =
            doc.animations.push({
              name: freeAnimationName(animationNameFrom(entry.target.animation), used),
              frames: entry.frames,
              frameMs: entry.frameMs,
            }) - 1;
        } else {
          const used = usedMotionKeys(doc);
          const key = SUGGESTED_KEYS.find((k) => !used.has(k));
          if (!key || doc.kind !== 'character' || doc.animations.length >= ANIMATION_LIMIT) {
            continue;
          }
          let n = 1;
          while (doc.animations.some((a) => a.name === `motion-${n}`)) n++;
          index =
            doc.animations.push({
              name: `motion-${n}`,
              frames: entry.frames,
              frameMs: entry.frameMs,
              key,
              label: entry.target.motion.slice(0, 16) || `모션 ${n}`,
              loop: true,
            }) - 1;
        }
        first ??= index;
        const name = doc.animations[index]!.name;
        const opposite = entry.mirror
          ? name.endsWith('-left')
            ? `${name.slice(0, -5)}-right`
            : name.endsWith('-right')
              ? `${name.slice(0, -6)}-left`
              : null
          : null;
        const other = opposite ? doc.animations.find((a) => a.name === opposite) : undefined;
        if (other) {
          other.frames = entry.frames.map(mirrorOf);
          other.frameMs = entry.frameMs;
        }
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
   * change를 문서 사본에 해 보고 저장할 때의 프레임 수를 센다 (이 문서는 그대로). 가져오기 전에 프레임 한도를
   * 넘는지 미리 본다 (예전엔 가져온 뒤 저장할 때에야 막혔다).
   */
  frameCountIf(change: (probe: PixelDocument) => void): number {
    const probe = new PixelDocument(snapshot(this.doc));
    change(probe);
    return probe.frameCount();
  }

  /**
   * 저장할 때의 프레임 수 (같은 그림은 하나로 센다). 예전엔 프레임마다 base64로 바꿔 비교해서
   * 큰 캐릭터는 그릴 때마다 느려졌다. 지문으로 묶고 바이트를 비교하며, 문서가 바뀔 때만 다시 센다.
   */
  frameCount(): number {
    if (this.counted?.version === this.version) return this.counted.count;
    const groups = new Map<number, Uint16Array[]>();
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
    return requiredOf(this.doc).filter((required) => {
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

  /**
   * 캐릭터가 쓰는 광장 방식을 바꾼다. 새 방식에 필요한데 없는 애니메이션은 더하고(점프는 걷기의 두 번째
   * 프레임을 복사, 나머지는 빈 프레임), 필요한 것을 앞에 둔다. 예전 방식에만 필요하던 것(위·아래 등)은
   * 지우지 않고 뒤에 남긴다 (다시 바꿀 때 그대로 쓰도록, 필요 없으면 따로 지운다).
   */
  setStyle(style: PlazaStyle): void {
    if (this.doc.kind !== 'character' || this.doc.style === style) return;
    this.edit((doc) => {
      doc.style = style;
      const required = REQUIRED_CHARACTER_ANIMATIONS[style];
      const byName = new Map(doc.animations.map((a) => [a.name, a]));
      const first = required.map((r) => {
        const existing = byName.get(r.name);
        if (existing) return existing;
        const added = blankRequired(r, doc.width, doc.height);
        if (r.name.startsWith('jump-')) {
          const walk = byName.get(r.name.replace('jump-', 'walk-'));
          const source = walk?.frames[Math.min(1, walk.frames.length - 1)];
          if (source) added.frames = [Uint16Array.from(source)];
        }
        return added;
      });
      const names = new Set(required.map((r) => r.name));
      doc.animations = [...first, ...doc.animations.filter((a) => !names.has(a.name))];
    });
  }

  /** 캐릭터의 광장 크기 (세로 타일) */
  setPlazaHeight(plazaHeight: number): void {
    if (this.doc.kind !== 'character' || this.doc.plazaHeight === plazaHeight) return;
    this.edit((doc) => {
      doc.plazaHeight = plazaHeight;
    });
  }

  /**
   * 애니메이터를 바꾼다 (없애려면 undefined). 그래프 편집은 매번 새 객체를 넘긴다 (되돌리기 사본이 예전 것을
   * 함께 쓰므로 그 자리에서 고치지 않는다). key가 같으면(상태 끌기, 이름 입력) 되돌리기 한 단계로 묶는다.
   */
  setAnimator(animator: Animator | undefined, key?: string): void {
    if (this.doc.kind !== 'character') return;
    this.edit((doc) => {
      if (animator) doc.animator = animator;
      else delete doc.animator;
    }, key);
  }

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
    if (!canResizeCharacter(this.doc, width, height)) return;
    this.edit((doc) => resizeCharacterDoc(doc, width, height));
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
   * 캐릭터의 머리 위·양옆 빈 곳 정리: 모든 프레임에서 함께 비어 있는 위 줄과 양옆 열을 잘라 해상도를 줄인다.
   * 광장은 발밑 가운데를 기준으로 세우므로 양옆은 덜 빈 쪽만큼만 똑같이 자르고(가운데가 그대로),
   * 해상도 최소(16px) 아래로는 줄이지 않는다. 발 아래는 trimBelowFeet가 맡는다. 빈 프레임은 세지 않는다.
   * 광장에서는 세로가 광장 크기만큼 그려지므로, 위가 비어 있던 캐릭터는 정리하면 그만큼 커 보인다.
   * 잘라 낸 위 줄 수와 한쪽 열 수를 돌려준다.
   */
  trimMargins(): { top: number; sides: number } {
    const { kind, width, height } = this.doc;
    const none = { top: 0, sides: 0 };
    if (kind !== 'character') return none;
    let top = height;
    let left = width;
    let right = width;
    for (const animation of this.doc.animations) {
      for (const pixels of animation.frames) {
        const box = drawnBox(pixels, width, height);
        if (!box) continue;
        top = Math.min(top, box.top);
        left = Math.min(left, box.left);
        right = Math.min(right, width - 1 - box.right);
      }
    }
    if (top === height) return none;
    const cut = {
      top: Math.max(0, Math.min(top, height - CHARACTER_MIN_SIZE)),
      sides: Math.max(0, Math.min(left, right, Math.floor((width - CHARACTER_MIN_SIZE) / 2))),
    };
    if (cut.top === 0 && cut.sides === 0) return none;
    this.edit((doc) => resizeCharacterDoc(doc, width - cut.sides * 2, height - cut.top));
    return cut;
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
    const cut = (pixels: Uint16Array) => {
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
  importFrames(ref: FrameRef, frames: Uint16Array[], palette: string[]): void {
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
