import { z } from 'zod';
import type { UserProfile } from './user.js';

export const MESSAGE_MAX_LENGTH = 4000;
export const MESSAGE_PAGE_SIZE = 50;

export const sendMessageSchema = z.object({
  channelId: z.uuid(),
  content: z.string().trim().min(1).max(MESSAGE_MAX_LENGTH),
});

export type SendMessageRequest = z.infer<typeof sendMessageSchema>;

export const messagesQuerySchema = z.object({
  /** 이 메시지보다 오래된 것을 가져온다 (없으면 최신부터) */
  before: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(MESSAGE_PAGE_SIZE),
});

export type MessagesQuery = z.infer<typeof messagesQuerySchema>;

export interface MessageDto {
  /** UUIDv7: 생성 시각 순서로 정렬된다 */
  id: string;
  channelId: string;
  author: UserProfile;
  content: string;
  createdAt: string;
}

/** 최신 메시지부터 내려준다. hasMore면 마지막 메시지 ID를 before로 다음 페이지를 요청한다. */
export interface MessagePage {
  messages: MessageDto[];
  hasMore: boolean;
}
