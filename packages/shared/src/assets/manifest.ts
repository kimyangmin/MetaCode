import { z } from 'zod';
import { TILE_SIZE } from '../plaza/layout.js';
import { decodePixels, isBlank } from './pixels.js';

/**
 * 에셋 = 픽셀 데이터 + 매니페스트(크기, 팔레트, 프레임, 애니메이션)를 담은 JSON 하나.
 * 내장 에셋과 도트 에디터로 만든 에셋이 같은 형식이다.
 *
 * 픽셀 값 0은 투명, v(1 이상)는 palette[v - 1]이다.
 */
export const AssetKind = {
  Tile: 'tile',
  Object: 'object',
  Character: 'character',
} as const;
export type AssetKind = (typeof AssetKind)[keyof typeof AssetKind];

/**
 * 캐릭터가 광장에서 차지하는 크기 (가로 1타일, 세로 2타일). 기준점은 발밑 가운데.
 * 매니페스트 해상도와 상관없이 늘 이 크기로 그리므로, 해상도를 올려도 충돌·이동·카메라는 그대로다.
 */
export const CHARACTER_WORLD_WIDTH = TILE_SIZE;
export const CHARACTER_WORLD_HEIGHT = TILE_SIZE * 2;

/**
 * 캐릭터 한 프레임의 해상도. 가로·세로 각각 16~512px이고 비율은 자유다 (기본 16×32).
 * 하나로 고정하지 않는 이유는 받아 온 에셋(32×64, 64×64, 256×512 등)을 줄이지 않고 그대로 쓰기 위해서다.
 */
export const CHARACTER_MIN_SIZE = 16;
export const CHARACTER_MAX_SIZE = 512;
/** 새로 그릴 때의 해상도 */
export const CHARACTER_DEFAULT_SIZE = {
  width: CHARACTER_WORLD_WIDTH,
  height: CHARACTER_WORLD_HEIGHT,
} as const;
/** 넓은 그림이라도 광장에서 이보다 넓게 그리지 않는다 (4타일) */
export const CHARACTER_WORLD_MAX_WIDTH = TILE_SIZE * 4;

/** 캐릭터로 쓸 수 있는 해상도인지 */
export function isCharacterSize(width: number, height: number): boolean {
  const ok = (v: number) =>
    Number.isInteger(v) && v >= CHARACTER_MIN_SIZE && v <= CHARACTER_MAX_SIZE;
  return ok(width) && ok(height);
}

/**
 * 광장에서 캐릭터를 그릴 크기 (월드 px). 세로는 늘 2타일이고 가로는 그림 비율대로다
 * (16×32면 1타일×2타일, 64×64면 2타일×2타일). 아주 넓은 그림은 가로 4타일에 맞춰 함께 줄인다.
 * 충돌·이동 검증은 발 영역만 보므로 그림 크기와 상관없다.
 */
export function characterWorldSize(
  width: number,
  height: number,
): {
  width: number;
  height: number;
} {
  const scale = Math.min(CHARACTER_WORLD_HEIGHT / height, CHARACTER_WORLD_MAX_WIDTH / width);
  return { width: width * scale, height: height * scale };
}
/** 오브젝트는 가로·세로 1~4타일 */
export const OBJECT_MAX_TILES = 4;
export const PALETTE_MAX_COLORS = 64;
export const ASSET_NAME_MAX_LENGTH = 32;
export const FRAME_LIMIT: Record<AssetKind, number> = { tile: 16, object: 8, character: 64 };
/**
 * 에셋 하나의 픽셀 총량 (해상도 × 프레임 수). 매니페스트를 그대로 DB에 넣고 광장에서 내려받으므로,
 * 해상도를 풀어 준 대신 총량을 막는다 (512×512이면 32프레임까지).
 */
export const ASSET_PIXEL_BUDGET = 512 * 512 * 32;
/**
 * 에셋 하나의 프레임 데이터 총 길이 (글자). 프레임은 도트 그림이면 RLE로 크게 줄어들지만(pixels.ts),
 * 색이 자주 바뀌는 큰 그림은 거의 줄지 않으므로 저장·전송 크기를 따로 막는다 (약 6MB).
 */
export const ASSET_ENCODED_MAX = 8 * 1024 * 1024;
export const FRAME_MS_MIN = 40;
export const FRAME_MS_MAX = 2000;
const ANIMATION_LIMIT = 32;

/** 타일과 오브젝트는 애니메이션 하나(이 이름)만 쓴다. 한 프레임이면 멈춘 그림이다. */
export const DEFAULT_ANIMATION = 'default';

/** 캐릭터에서 색을 바꿀 수 있는 부위. 부위마다 [밝은 면, 그림자, 외곽선] 팔레트 칸을 가리킨다 */
export const COLOR_SLOTS = ['skin', 'hair', 'shirt', 'pants', 'shoes'] as const;
export type ColorSlot = (typeof COLOR_SLOTS)[number];

export const CHARACTER_DIRECTIONS = ['down', 'left', 'right', 'up'] as const;
const DIRECTION_LABEL: Record<(typeof CHARACTER_DIRECTIONS)[number], string> = {
  down: '아래',
  left: '왼쪽',
  right: '오른쪽',
  up: '위',
};

export interface RequiredAnimation {
  name: string;
  minFrames: number;
  label: string;
}

/** 캐릭터를 저장하려면 모두 그려야 하는 애니메이션 */
export const REQUIRED_CHARACTER_ANIMATIONS: readonly RequiredAnimation[] = [
  ...CHARACTER_DIRECTIONS.map((dir) => ({
    name: `idle-${dir}`,
    minFrames: 1,
    label: `대기 (${DIRECTION_LABEL[dir]})`,
  })),
  ...CHARACTER_DIRECTIONS.map((dir) => ({
    name: `walk-${dir}`,
    minFrames: 2,
    label: `걷기 (${DIRECTION_LABEL[dir]})`,
  })),
  { name: 'emote', minFrames: 2, label: '첨부 모션' },
];

/**
 * 광장에서 공중에 있을 때(횡스크롤 점프·떨어지기) 트는 애니메이션. 없으면 걷기의 두 번째 프레임을 쓴다
 * (필수가 아닌 캐릭터 애니메이션).
 */
export const JUMP_ANIMATIONS = ['jump-left', 'jump-right'] as const;

/**
 * 캐릭터 모션: 필수 애니메이션 말고 직접 추가해서 광장에서 숫자 키로 트는 애니메이션 (춤, 인사 등).
 * 키는 숫자 1~9, 0이라 한 캐릭터에 열 개까지다.
 */
export const MOTION_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] as const;
export type MotionKey = (typeof MOTION_KEYS)[number];
export const MOTION_LABEL_MAX_LENGTH = 16;

const hexColor = z.string().regex(/^#[0-9a-f]{6}$/, '색은 #rrggbb 형식이어야 합니다.');

const animationSchema = z.object({
  frames: z.array(z.number().int().min(0)).min(1).max(FRAME_LIMIT.character),
  frameMs: z.number().int().min(FRAME_MS_MIN).max(FRAME_MS_MAX),
  /** 캐릭터 모션: 화면에 보일 이름 (애니메이션 이름은 영문이라 따로 둔다) */
  label: z.string().trim().min(1).max(MOTION_LABEL_MAX_LENGTH).optional(),
  /** 캐릭터 모션: 광장에서 이 숫자 키를 누르면 튼다 */
  key: z.enum(MOTION_KEYS).optional(),
  /** 캐릭터 모션: 움직이거나 다시 누를 때까지 반복한다 (없으면 한 번) */
  loop: z.boolean().optional(),
});
export type AssetAnimation = z.infer<typeof animationSchema>;

/**
 * 가장 큰 프레임(캐릭터 512×512) 하나의 base64 길이. 이보다 길면 풀어 볼 필요도 없다
 * (RLE는 그냥 base64보다 짧을 때만 쓰므로 이 길이를 넘지 않는다).
 */
const MAX_FRAME_BASE64 = 4 * Math.ceil((CHARACTER_MAX_SIZE * CHARACTER_MAX_SIZE) / 3);

const manifestShape = z.object({
  kind: z.enum([AssetKind.Tile, AssetKind.Object, AssetKind.Character]),
  name: z.string().trim().min(1).max(ASSET_NAME_MAX_LENGTH),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  palette: z.array(hexColor).min(1).max(PALETTE_MAX_COLORS),
  frames: z.array(z.string().max(MAX_FRAME_BASE64)).min(1).max(FRAME_LIMIT.character),
  animations: z.record(z.string().regex(/^[a-z][a-z0-9-]{0,31}$/), animationSchema),
  /** 타일: 지나갈 수 없는 칸인지 (횡스크롤에서는 땅·벽) */
  solid: z.boolean().optional(),
  /** 타일: 횡스크롤의 발판인지 (위에서 내려올 때만 딛고, 아래·옆에서는 지나간다. 탑다운에서는 막지 않음) */
  platform: z.boolean().optional(),
  /** 오브젝트: 그림을 덮는 타일 격자(row-major) 중 지나갈 수 없는 칸. 1이면 막힘 */
  footprint: z.array(z.union([z.literal(0), z.literal(1)])).optional(),
  /** 캐릭터: 색을 바꿀 수 있는 부위 → [밝은 면, 그림자, 외곽선] 픽셀 값 */
  colorSlots: z
    .partialRecord(z.enum(COLOR_SLOTS), z.array(z.number().int().min(1)).length(3))
    .optional(),
});

export type AssetManifest = z.infer<typeof manifestShape>;

/** 프레임을 푼다. 그림 크기보다 크게 풀리는 것(압축 폭탄)은 null */
export function decodeFrames(manifest: AssetManifest): (Uint8Array | null)[] {
  const size = manifest.width * manifest.height;
  return manifest.frames.map((frame) => decodePixels(frame, size));
}

export interface CharacterMotion {
  /** 애니메이션 이름 */
  name: string;
  key: MotionKey;
  label: string;
  loop: boolean;
}

/** 캐릭터의 모션 (키 순서: 1, 2, …, 9, 0) */
export function characterMotions(manifest: Pick<AssetManifest, 'animations'>): CharacterMotion[] {
  return Object.entries(manifest.animations)
    .filter(([, animation]) => animation.key !== undefined)
    .map(([name, animation]) => ({
      name,
      key: animation.key!,
      label: animation.label ?? name,
      loop: animation.loop ?? false,
    }))
    .sort((a, b) => MOTION_KEYS.indexOf(a.key) - MOTION_KEYS.indexOf(b.key));
}

/** 캐릭터에 빠진 애니메이션 (없거나, 프레임이 모자라거나, 빈 프레임이 있음) */
export function missingAnimations(manifest: AssetManifest): RequiredAnimation[] {
  const frames = decodeFrames(manifest);
  return REQUIRED_CHARACTER_ANIMATIONS.filter((required) => {
    const animation = manifest.animations[required.name];
    if (!animation || animation.frames.length < required.minFrames) return true;
    return animation.frames.some((index) => {
      const pixels = frames[index];
      return !pixels || isBlank(pixels);
    });
  });
}

/** 크기, 프레임 수, 픽셀 값, 종류별 필수 항목을 확인한다. 문제가 없으면 빈 배열 */
export function manifestProblems(manifest: AssetManifest): string[] {
  const problems: string[] = [];
  const { kind, width, height } = manifest;

  if (kind === AssetKind.Tile && (width !== TILE_SIZE || height !== TILE_SIZE)) {
    problems.push(`타일은 ${TILE_SIZE}×${TILE_SIZE}px이어야 합니다.`);
  }
  if (kind === AssetKind.Character && !isCharacterSize(width, height)) {
    problems.push(
      `캐릭터 해상도는 가로·세로 ${CHARACTER_MIN_SIZE}~${CHARACTER_MAX_SIZE}px이어야 합니다.`,
    );
  }
  const maxObject = OBJECT_MAX_TILES * TILE_SIZE;
  if (
    kind === AssetKind.Object &&
    [width, height].some((v) => v % TILE_SIZE !== 0 || v > maxObject)
  ) {
    problems.push(`오브젝트 크기는 ${TILE_SIZE}px 단위로 최대 ${maxObject}px입니다.`);
  }
  if (problems.length > 0) return problems;

  if (manifest.frames.length > FRAME_LIMIT[kind]) {
    problems.push(`프레임은 ${FRAME_LIMIT[kind]}장까지입니다.`);
  }
  if (manifest.frames.reduce((sum, frame) => sum + frame.length, 0) > ASSET_ENCODED_MAX) {
    problems.push('그림 데이터가 너무 큽니다. 해상도나 프레임 수, 색 수를 줄이세요.');
    return problems;
  }
  if (width * height * manifest.frames.length > ASSET_PIXEL_BUDGET) {
    problems.push(
      `에셋이 너무 큽니다 (${width}×${height} × ${manifest.frames.length}장). 해상도나 프레임 수를 줄이세요.`,
    );
  }
  decodeFrames(manifest).forEach((pixels, i) => {
    if (!pixels || pixels.length !== width * height) {
      problems.push(`${i + 1}번 프레임의 크기가 맞지 않습니다.`);
    } else if (pixels.some((v) => v > manifest.palette.length)) {
      problems.push(`${i + 1}번 프레임에 팔레트에 없는 색이 있습니다.`);
    }
  });

  const animations = Object.entries(manifest.animations);
  if (animations.length > ANIMATION_LIMIT) {
    problems.push(`애니메이션은 ${ANIMATION_LIMIT}개까지입니다.`);
  }
  for (const [name, animation] of animations) {
    if (animation.frames.some((i) => i >= manifest.frames.length)) {
      problems.push(`${name} 애니메이션이 없는 프레임을 가리킵니다.`);
    }
  }

  const motionProblems = (): string[] => {
    const found: string[] = [];
    const keys = new Set<string>();
    const required = new Set(REQUIRED_CHARACTER_ANIMATIONS.map((r) => r.name));
    for (const [name, animation] of animations) {
      const motion =
        animation.key !== undefined ||
        animation.label !== undefined ||
        animation.loop !== undefined;
      if (!motion) continue;
      if (kind !== AssetKind.Character) {
        found.push('모션(키, 이름, 반복)은 캐릭터만 쓸 수 있습니다.');
        break;
      }
      if (required.has(name)) found.push(`${name}: 필수 애니메이션에는 모션 키를 달 수 없습니다.`);
      if (animation.key === undefined) found.push(`${name}: 모션에는 키가 있어야 합니다.`);
      else if (keys.has(animation.key)) found.push(`모션 키 ${animation.key}가 겹칩니다.`);
      else keys.add(animation.key);
    }
    return found;
  };
  problems.push(...motionProblems());

  if (kind === AssetKind.Character) {
    const missing = missingAnimations(manifest);
    if (missing.length > 0) {
      problems.push(`그리지 않은 애니메이션이 있습니다: ${missing.map((m) => m.label).join(', ')}`);
    }
    for (const indices of Object.values(manifest.colorSlots ?? {})) {
      if (indices.some((v) => v > manifest.palette.length)) {
        problems.push('색 부위가 팔레트에 없는 색을 가리킵니다.');
      }
    }
  } else {
    if (!manifest.animations[DEFAULT_ANIMATION]) {
      problems.push(`${DEFAULT_ANIMATION} 애니메이션이 있어야 합니다.`);
    }
    if (manifest.colorSlots) problems.push('색 부위는 캐릭터만 쓸 수 있습니다.');
  }

  if (kind !== AssetKind.Tile && manifest.solid !== undefined) {
    problems.push('지나갈 수 없음(solid)은 타일만 쓸 수 있습니다.');
  }
  if (kind !== AssetKind.Tile && manifest.platform !== undefined) {
    problems.push('발판(platform)은 타일만 쓸 수 있습니다.');
  }
  if (manifest.solid && manifest.platform) {
    problems.push('지나갈 수 없는 타일은 발판이 될 수 없습니다.');
  }
  const cells = (width / TILE_SIZE) * (height / TILE_SIZE);
  if (kind === AssetKind.Object) {
    if (manifest.footprint?.length !== cells) {
      problems.push('오브젝트의 막힌 칸(footprint) 크기가 맞지 않습니다.');
    }
  } else if (manifest.footprint) {
    problems.push('막힌 칸(footprint)은 오브젝트만 쓸 수 있습니다.');
  }
  return problems;
}

/** 저장 요청 검증 (서버가 받는 모든 에셋은 이것을 통과해야 한다) */
export const assetManifestSchema = manifestShape.superRefine((manifest, ctx) => {
  for (const message of manifestProblems(manifest)) ctx.addIssue({ code: 'custom', message });
});

/** 에셋 참조: 내장 에셋 `builtin:<이름>` 또는 직접 만든 에셋의 ID(uuid) */
export type AssetRef = string;
export const BUILTIN_PREFIX = 'builtin:';
export const assetRefSchema = z
  .string()
  .regex(
    /^(builtin:[a-z0-9-]{1,48}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/,
    '에셋 참조 형식이 올바르지 않습니다.',
  );

export function isBuiltinRef(ref: AssetRef): boolean {
  return ref.startsWith(BUILTIN_PREFIX);
}

/** 오브젝트의 막힌 칸을 타일 좌표로. (x, y)는 오브젝트를 놓은 칸 = 그림의 왼쪽 아래 칸 */
export function footprintCells(
  manifest: Pick<AssetManifest, 'width' | 'height' | 'footprint'>,
  x: number,
  y: number,
): { x: number; y: number }[] {
  const cols = manifest.width / TILE_SIZE;
  const rows = manifest.height / TILE_SIZE;
  const cells: { x: number; y: number }[] = [];
  manifest.footprint?.forEach((blocked, i) => {
    if (!blocked) return;
    const col = i % cols;
    const row = Math.floor(i / cols);
    cells.push({ x: x + col, y: y - (rows - 1 - row) });
  });
  return cells;
}
