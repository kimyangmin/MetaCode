import { z } from 'zod';
import type { ChannelType } from '../domain/channel.js';
import type { UserProfile } from './user.js';

/**
 * 채널 이름: 앞뒤 공백을 지우고, 중간 공백은 하이픈으로 바꾸고, 영문은 소문자로 맞춘다 (Discord 방식).
 * 한글은 그대로 둔다.
 */
export const channelNameSchema = z
  .string()
  .trim()
  .transform((s) => s.replace(/\s+/g, '-').toLowerCase())
  .pipe(z.string().min(1, '이름을 입력해 주세요.').max(30));

export const createChannelSchema = z.object({
  name: channelNameSchema,
});

export type CreateChannelRequest = z.infer<typeof createChannelSchema>;

export interface ChannelSummary {
  id: string;
  type: ChannelType;
  communityId: string | null;
  /** 커뮤니티 채널 이름. DM은 null (참여자 이름으로 표시) */
  name: string | null;
  /** 가장 최근 메시지 ID (UUIDv7이라 문자열 비교로 순서를 알 수 있다). 메시지가 없으면 null */
  lastMessageId: string | null;
  /** 내가 마지막으로 읽은 메시지 ID */
  lastReadMessageId: string | null;
}

/** DM과 그룹 DM. 참여자에는 나도 포함된다. */
export interface DmSummary extends ChannelSummary {
  participants: UserProfile[];
}

export const createDmSchema = z.object({
  /** 나를 뺀 상대. 1명이면 1:1 DM, 2명 이상이면 그룹 DM (나 포함 최대 10명) */
  userIds: z
    .array(z.uuid())
    .min(1)
    .max(9)
    .transform((ids) => [...new Set(ids)]),
});

export type CreateDmRequest = z.infer<typeof createDmSchema>;

export const readStateSchema = z.object({
  lastReadMessageId: z.uuid(),
});

export type ReadStateRequest = z.infer<typeof readStateSchema>;

/** 안 읽은 메시지가 있는지. UUIDv7은 시간순이라 문자열 비교로 충분하다. */
export function hasUnread(channel: Pick<ChannelSummary, 'lastMessageId' | 'lastReadMessageId'>) {
  if (!channel.lastMessageId) return false;
  return !channel.lastReadMessageId || channel.lastMessageId > channel.lastReadMessageId;
}
