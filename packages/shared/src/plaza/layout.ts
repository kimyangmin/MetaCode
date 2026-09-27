import { PlazaMap } from '../domain/plaza.js';

/** 타일 한 칸 (px). 도트 에셋 규격: 타일 16×16, 캐릭터 16×32 */
export const TILE_SIZE = 16;

/** 장애물 종류. 배치(충돌)에만 쓰고, 어떻게 그릴지는 클라이언트의 테마가 정한다. */
export type ObstacleKind = 'wall' | 'fountain' | 'tree' | 'bench' | 'campfire' | 'log';

/** 지나갈 수 없는 사각형 영역 (타일 단위) */
export interface Obstacle {
  kind: ObstacleKind;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 지나갈 수 있는 장식 (길 등). 충돌에는 쓰지 않는다. */
export interface Decoration {
  kind: 'path' | 'plaza-floor' | 'firelight';
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 맵 배치: 크기, 충돌, 스폰 지점. 테마가 바뀌어도 그대로다 (설계 원칙: 배치와 겉모습을 나눈다).
 * 나중에 Tiled 맵으로 옮기면 이 형식으로 읽어 들인다.
 */
export interface MapLayout {
  key: PlazaMap;
  /** 타일 단위 */
  width: number;
  height: number;
  obstacles: Obstacle[];
  decorations: Decoration[];
  /** 처음 나타나는 영역 (타일 단위) */
  spawn: { x: number; y: number; w: number; h: number };
  /** 타일별 통행 불가 여부 (row-major, width × height) */
  blocked: Uint8Array;
}

function buildLayout(layout: Omit<MapLayout, 'blocked'>): MapLayout {
  const blocked = new Uint8Array(layout.width * layout.height);
  for (const o of layout.obstacles) {
    for (let y = o.y; y < o.y + o.h; y++) {
      for (let x = o.x; x < o.x + o.w; x++) {
        if (x >= 0 && y >= 0 && x < layout.width && y < layout.height) {
          blocked[y * layout.width + x] = 1;
        }
      }
    }
  }
  return { ...layout, blocked };
}

/** 맵 가장자리를 두르는 한 칸짜리 장애물 */
function border(kind: ObstacleKind, width: number, height: number): Obstacle[] {
  return [
    { kind, x: 0, y: 0, w: width, h: 1 },
    { kind, x: 0, y: height - 1, w: width, h: 1 },
    { kind, x: 0, y: 1, w: 1, h: height - 2 },
    { kind, x: width - 1, y: 1, w: 1, h: height - 2 },
  ];
}

/** 분수 광장: 커뮤니티마다 하나. 분수가 가운데 있는 넓은 광장 */
const fountainSquare = buildLayout({
  key: PlazaMap.FountainSquare,
  width: 48,
  height: 36,
  obstacles: [
    ...border('wall', 48, 36),
    { kind: 'fountain', x: 21, y: 15, w: 6, h: 5 },
    { kind: 'tree', x: 3, y: 3, w: 2, h: 2 },
    { kind: 'tree', x: 43, y: 3, w: 2, h: 2 },
    { kind: 'tree', x: 3, y: 31, w: 2, h: 2 },
    { kind: 'tree', x: 43, y: 31, w: 2, h: 2 },
    { kind: 'bench', x: 14, y: 10, w: 3, h: 1 },
    { kind: 'bench', x: 31, y: 10, w: 3, h: 1 },
    { kind: 'bench', x: 14, y: 25, w: 3, h: 1 },
    { kind: 'bench', x: 31, y: 25, w: 3, h: 1 },
  ],
  decorations: [
    { kind: 'plaza-floor', x: 12, y: 8, w: 24, h: 20 },
    { kind: 'path', x: 22, y: 1, w: 4, h: 7 },
    { kind: 'path', x: 22, y: 28, w: 4, h: 7 },
    { kind: 'path', x: 1, y: 16, w: 11, h: 3 },
    { kind: 'path', x: 36, y: 16, w: 11, h: 3 },
  ],
  spawn: { x: 19, y: 21, w: 10, h: 4 },
});

/** 모닥불 캠프: DM마다 하나. 모닥불이 가운데 있는 좁은 야외 공간 */
const campfire = buildLayout({
  key: PlazaMap.Campfire,
  width: 16,
  height: 12,
  obstacles: [
    ...border('tree', 16, 12),
    { kind: 'campfire', x: 7, y: 5, w: 2, h: 2 },
    { kind: 'log', x: 6, y: 3, w: 4, h: 1 },
    { kind: 'log', x: 4, y: 5, w: 1, h: 2 },
    { kind: 'log', x: 11, y: 5, w: 1, h: 2 },
  ],
  decorations: [{ kind: 'firelight', x: 4, y: 3, w: 8, h: 6 }],
  spawn: { x: 5, y: 8, w: 6, h: 2 },
});

export const MAP_LAYOUTS: Record<PlazaMap, MapLayout> = {
  [PlazaMap.FountainSquare]: fountainSquare,
  [PlazaMap.Campfire]: campfire,
};
