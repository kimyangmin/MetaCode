import { z } from 'zod';
import type { UserProfile } from '../api/user.js';
import type { PlazaId, PlazaMap } from '../domain/plaza.js';
import type { Direction } from './movement.js';

const uuidRe = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

export const plazaIdSchema = z
  .string()
  .regex(new RegExp(`^(community|dm):${uuidRe}$`), '광장 ID 형식이 올바르지 않습니다.')
  .transform((v) => v as PlazaId);

export function parsePlazaId(plazaId: PlazaId): { kind: 'community' | 'dm'; id: string } {
  const [kind, id] = plazaId.split(':') as ['community' | 'dm', string];
  return { kind, id };
}

export const directionSchema = z.enum(['down', 'up', 'left', 'right']);

export const plazaWatchSchema = z.object({ plazaId: plazaIdSchema });

export const plazaMoveSchema = z.object({
  plazaId: plazaIdSchema,
  x: z.number().finite(),
  y: z.number().finite(),
  dir: directionSchema,
  moving: z.boolean(),
});

export type PlazaMoveRequest = z.infer<typeof plazaMoveSchema>;

/** 광장에 있는 사람 한 명 (그 광장의 온라인 멤버) */
export interface PlazaOccupant {
  user: UserProfile;
  x: number;
  y: number;
  dir: Direction;
  moving: boolean;
}

/** 광장을 열 때 받는 전체 상태 */
export interface PlazaSnapshot {
  plazaId: PlazaId;
  map: PlazaMap;
  /** 테마 키. 지금은 항상 default */
  theme: string;
  occupants: PlazaOccupant[];
}

export interface PlazaMoved {
  plazaId: PlazaId;
  userId: string;
  x: number;
  y: number;
  dir: Direction;
  moving: boolean;
}

/** 광장 인원 변화: 온라인이 되어 나타나거나(occupant), 오프라인이 되어 사라진다(null) */
export interface PlazaMemberChange {
  plazaId: PlazaId;
  userId: string;
  occupant: PlazaOccupant | null;
}

/** 서버가 받아들이지 않은 이동. 이 위치로 되돌린다. */
export interface PlazaCorrection {
  plazaId: PlazaId;
  x: number;
  y: number;
  dir: Direction;
}
