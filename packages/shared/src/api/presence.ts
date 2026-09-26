import { z } from 'zod';

export const presenceQuerySchema = z.object({
  /** 쉼표로 구분한 사용자 ID. 한 번에 최대 100명 */
  userIds: z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(z.uuid()).min(1).max(100)),
});

export type PresenceQuery = z.infer<typeof presenceQuerySchema>;

/** 사용자 ID → 온라인 여부 */
export type PresenceResponse = Record<string, boolean>;
