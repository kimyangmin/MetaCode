import { DEFAULT_THEME, PlazaMap } from '@metacode/shared';

/**
 * 테마 = 맵의 겉모습. 배치(충돌, 스폰)는 packages/shared의 MapLayout이고, 여기는 색만 정한다.
 * 도트 에셋이 들어오면 색 대신 타일셋 경로를 두고, 테마를 추가해도 배치는 그대로다.
 */
export interface ThemeAppearance {
  ground: string;
  groundSpeckle: string;
  path: string;
  plazaFloor: string;
  wall: string;
  wallTop: string;
  fountainStone: string;
  water: string;
  waterLight: string;
  treeTrunk: string;
  treeLeaves: string;
  treeLeavesLight: string;
  bench: string;
  log: string;
  fire: [string, string, string];
  firelight: string;
}

const THEMES: Record<PlazaMap, Record<string, ThemeAppearance>> = {
  [PlazaMap.FountainSquare]: {
    [DEFAULT_THEME]: {
      ground: '#5a8f3d',
      groundSpeckle: '#4d7f33',
      path: '#c9b48a',
      plazaFloor: '#b9b2a4',
      wall: '#2f5d2a',
      wallTop: '#3f7536',
      fountainStone: '#9aa3ad',
      water: '#3d8fd6',
      waterLight: '#8cc8f5',
      treeTrunk: '#6b4a2b',
      treeLeaves: '#2f6b2a',
      treeLeavesLight: '#4a8f3a',
      bench: '#8a5a33',
      log: '#7a4f2c',
      fire: ['#ff8a00', '#ffd23f', '#ff4d00'],
      firelight: '#ffb347',
    },
  },
  [PlazaMap.Campfire]: {
    [DEFAULT_THEME]: {
      ground: '#3f5a33',
      groundSpeckle: '#35502b',
      path: '#6d5a3f',
      plazaFloor: '#5b4a36',
      wall: '#1f3a1d',
      wallTop: '#2b4d27',
      fountainStone: '#8a8f96',
      water: '#3d8fd6',
      waterLight: '#8cc8f5',
      treeTrunk: '#5a3d22',
      treeLeaves: '#1f4a1f',
      treeLeavesLight: '#2e6a2a',
      bench: '#7a4f2c',
      log: '#6b4426',
      fire: ['#ff8a00', '#ffd23f', '#ff4d00'],
      firelight: '#ffb347',
    },
  },
};

export function appearanceFor(map: PlazaMap, theme: string): ThemeAppearance {
  return THEMES[map][theme] ?? THEMES[map][DEFAULT_THEME]!;
}
