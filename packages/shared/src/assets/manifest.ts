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

/** 캐릭터 한 프레임 (가로 1타일, 세로 2타일). 기준점은 발밑 가운데 */
export const CHARACTER_WIDTH = 16;
export const CHARACTER_HEIGHT = 32;
/** 오브젝트는 가로·세로 1~4타일 */
export const OBJECT_MAX_TILES = 4;
export const PALETTE_MAX_COLORS = 64;
export const ASSET_NAME_MAX_LENGTH = 32;
export const FRAME_LIMIT: Record<AssetKind, number> = { tile: 16, object: 8, character: 64 };
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

const hexColor = z.string().regex(/^#[0-9a-f]{6}$/, '색은 #rrggbb 형식이어야 합니다.');

const animationSchema = z.object({
  frames: z.array(z.number().int().min(0)).min(1).max(FRAME_LIMIT.character),
  frameMs: z.number().int().min(FRAME_MS_MIN).max(FRAME_MS_MAX),
});
export type AssetAnimation = z.infer<typeof animationSchema>;

const manifestShape = z.object({
  kind: z.enum([AssetKind.Tile, AssetKind.Object, AssetKind.Character]),
  name: z.string().trim().min(1).max(ASSET_NAME_MAX_LENGTH),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  palette: z.array(hexColor).min(1).max(PALETTE_MAX_COLORS),
  // 가장 큰 프레임(64×64) 하나의 base64 길이보다 길면 볼 필요도 없다.
  frames: z.array(z.string().max(5464)).min(1).max(FRAME_LIMIT.character),
  animations: z.record(z.string().regex(/^[a-z][a-z0-9-]{0,31}$/), animationSchema),
  /** 타일: 지나갈 수 없는 칸인지 */
  solid: z.boolean().optional(),
  /** 오브젝트: 그림을 덮는 타일 격자(row-major) 중 지나갈 수 없는 칸. 1이면 막힘 */
  footprint: z.array(z.union([z.literal(0), z.literal(1)])).optional(),
  /** 캐릭터: 색을 바꿀 수 있는 부위 → [밝은 면, 그림자, 외곽선] 픽셀 값 */
  colorSlots: z
    .partialRecord(z.enum(COLOR_SLOTS), z.array(z.number().int().min(1)).length(3))
    .optional(),
});

export type AssetManifest = z.infer<typeof manifestShape>;

export function decodeFrames(manifest: AssetManifest): (Uint8Array | null)[] {
  return manifest.frames.map(decodePixels);
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
  if (kind === AssetKind.Character && (width !== CHARACTER_WIDTH || height !== CHARACTER_HEIGHT)) {
    problems.push(`캐릭터는 ${CHARACTER_WIDTH}×${CHARACTER_HEIGHT}px이어야 합니다.`);
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
