import { z } from 'zod';
import { PlazaStyle } from '../domain/plaza.js';
import { Cell, type MapLayout, TILE_SIZE } from '../plaza/layout.js';
import {
  type AssetKind,
  type AssetManifest,
  type AssetRef,
  AssetKind as Kind,
  assetRefSchema,
  footprintCells,
} from './manifest.js';
import { decodePixels } from './pixels.js';

/**
 * 맵 정의: 타일 두 층(바닥, 장식) + 오브젝트 + 스폰 영역. 내장 맵과 맵 에디터로 만든 맵이 같은 형식이다.
 * 충돌은 타일의 solid(와 횡스크롤의 platform)와 오브젝트의 footprint에서 계산한다 (buildCollision).
 *
 * style이 횡스크롤이면 옆에서 본 맵이다: 빈칸은 하늘, 지나갈 수 없는 타일은 땅, 발판 타일은 위에서만 딛는다.
 * 오브젝트는 배경이라 막지 않고, 바닥 층은 캐릭터 뒤, 장식 층은 캐릭터 앞에 그린다.
 */
export const MAP_MIN_SIZE = 12;
export const MAP_MAX_SIZE = 64;
/** 맵 하나에 쓸 수 있는 타일 종류 (격자에 1바이트로 담는다) */
export const MAP_TILE_KINDS_MAX = 255;
export const MAP_OBJECTS_MAX = 512;

const rectSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
});

const mapShape = z.object({
  width: z.number().int().min(MAP_MIN_SIZE).max(MAP_MAX_SIZE),
  height: z.number().int().min(MAP_MIN_SIZE).max(MAP_MAX_SIZE),
  /** 이 맵에 쓰는 타일 에셋. 격자의 값 v(1 이상)는 tiles[v - 1], 0은 빈칸 */
  tiles: z.array(assetRefSchema).max(MAP_TILE_KINDS_MAX),
  /** 바닥 층 격자 (row-major, base64) */
  ground: z.string().max(8192),
  /** 장식 층 격자: 꽃, 버섯처럼 바닥 위에 겹쳐 그리는 투명한 타일 */
  overlay: z.string().max(8192),
  /** (x, y) = 오브젝트 그림의 왼쪽 아래 칸 */
  objects: z
    .array(z.object({ asset: assetRefSchema, x: z.number().int(), y: z.number().int() }))
    .max(MAP_OBJECTS_MAX),
  /** 처음 나타나는 영역 (타일 단위) */
  spawn: rectSchema,
  /** 광장 방식. 없으면 탑다운 (이 필드가 생기기 전에 저장한 맵) */
  style: z.enum([PlazaStyle.TopDown, PlazaStyle.SideScroll]).optional(),
});

export type MapDefinition = z.infer<typeof mapShape>;
export type MapObject = MapDefinition['objects'][number];

/** 충돌 계산에 필요한 에셋 정보 */
export type AssetCollision = Pick<
  AssetManifest,
  'kind' | 'width' | 'height' | 'solid' | 'platform' | 'footprint'
>;

/** 맵의 광장 방식 (style이 없으면 탑다운) */
export function mapStyle(map: Pick<MapDefinition, 'style'>): PlazaStyle {
  return map.style ?? PlazaStyle.TopDown;
}

/** 형식과 범위만 본다 (에셋이 실제로 있는지는 mapAssetProblems) */
export function mapProblems(map: MapDefinition): string[] {
  const problems: string[] = [];
  const cells = map.width * map.height;
  for (const [name, encoded] of [
    ['바닥', map.ground],
    ['장식', map.overlay],
  ] as const) {
    const grid = decodePixels(encoded);
    if (!grid || grid.length !== cells) problems.push(`${name} 층의 크기가 맞지 않습니다.`);
    else if (grid.some((v) => v > map.tiles.length)) {
      problems.push(`${name} 층에 목록에 없는 타일이 있습니다.`);
    }
  }
  const { spawn } = map;
  if (spawn.x + spawn.w > map.width || spawn.y + spawn.h > map.height) {
    problems.push('스폰 영역이 맵 밖에 있습니다.');
  }
  for (const object of map.objects) {
    if (object.x < 0 || object.y < 0 || object.x >= map.width || object.y >= map.height) {
      problems.push('맵 밖에 놓인 오브젝트가 있습니다.');
      break;
    }
  }
  return problems;
}

/** 쓰는 에셋이 모두 있고 종류가 맞는지 */
export function mapAssetProblems(
  map: MapDefinition,
  metaOf: (ref: AssetRef) => AssetCollision | undefined,
): string[] {
  const problems: string[] = [];
  const expect = (ref: AssetRef, kind: AssetKind) => {
    const meta = metaOf(ref);
    if (!meta) problems.push(`없는 에셋을 씁니다: ${ref}`);
    else if (meta.kind !== kind) {
      problems.push(`${ref}: ${kind === Kind.Tile ? '타일이' : '오브젝트가'} 아닙니다.`);
    }
  };
  for (const ref of new Set(map.tiles)) expect(ref, Kind.Tile);
  for (const ref of new Set(map.objects.map((o) => o.asset))) expect(ref, Kind.Object);
  return problems;
}

export const mapDefinitionSchema = mapShape.superRefine((map, ctx) => {
  for (const message of mapProblems(map)) ctx.addIssue({ code: 'custom', message });
});

/**
 * 타일의 solid와 오브젝트의 footprint로 막힌 칸을 계산한다. 모르는 에셋은 막지 않는다.
 * 횡스크롤이면 발판 타일은 Cell.Platform이고, 오브젝트는 배경이라 막지 않는다.
 */
export function buildCollision(
  map: MapDefinition,
  metaOf: (ref: AssetRef) => AssetCollision | undefined,
): MapLayout {
  const style = mapStyle(map);
  const side = style === PlazaStyle.SideScroll;
  const cells = map.width * map.height;
  const blocked = new Uint8Array(cells);
  const kindOf = map.tiles.map((ref) => {
    const meta = metaOf(ref);
    if (meta?.solid) return Cell.Solid;
    return side && meta?.platform ? Cell.Platform : Cell.Open;
  });
  for (const encoded of [map.ground, map.overlay]) {
    const grid = decodePixels(encoded);
    if (!grid) continue;
    for (let i = 0; i < Math.min(cells, grid.length); i++) {
      const v = grid[i]!;
      const kind = v > 0 ? kindOf[v - 1]! : Cell.Open;
      // 두 층이 겹치면 막힌 칸이 발판보다 먼저다
      if (kind === Cell.Solid || (kind === Cell.Platform && blocked[i] === Cell.Open)) {
        blocked[i] = kind;
      }
    }
  }
  if (!side) {
    for (const object of map.objects) {
      const meta = metaOf(object.asset);
      if (!meta) continue;
      for (const cell of footprintCells(meta, object.x, object.y)) {
        if (cell.x >= 0 && cell.y >= 0 && cell.x < map.width && cell.y < map.height) {
          blocked[cell.y * map.width + cell.x] = Cell.Solid;
        }
      }
    }
  }
  return { width: map.width, height: map.height, blocked, spawn: map.spawn, style };
}

/** 오브젝트 그림의 월드 좌표 (px): 왼쪽 위 모서리. 앞뒤는 아래쪽 끝(bottom)으로 정한다 */
export function objectBounds(meta: Pick<AssetManifest, 'width' | 'height'>, object: MapObject) {
  const left = object.x * TILE_SIZE;
  const bottom = (object.y + 1) * TILE_SIZE;
  return { left, top: bottom - meta.height, bottom };
}
