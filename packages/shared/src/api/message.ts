import { z } from 'zod';
import { type AttachmentDto, MAX_ATTACHMENTS_PER_MESSAGE } from './attachment.js';
import type { UserProfile } from './user.js';

export const MESSAGE_MAX_LENGTH = 4000;
export const MESSAGE_PAGE_SIZE = 50;

/** 글이나 첨부 중 하나는 있어야 한다. */
export const sendMessageSchema = z
  .object({
    channelId: z.uuid(),
    content: z.string().trim().max(MESSAGE_MAX_LENGTH).default(''),
    attachmentIds: z
      .array(z.uuid())
      .max(MAX_ATTACHMENTS_PER_MESSAGE)
      .default([])
      .transform((ids) => [...new Set(ids)]),
    /** 답장할 메시지 (같은 채널) */
    replyToId: z.uuid().optional(),
  })
  .refine((m) => m.content.length > 0 || m.attachmentIds.length > 0, {
    message: '메시지나 첨부 파일이 필요합니다.',
  });

export type SendMessageRequest = z.input<typeof sendMessageSchema>;

/** 메시지 전달: 볼 수 있는 메시지를 쓸 수 있는 다른 채널(또는 DM)로. 첨부도 함께 복사된다 */
export const forwardMessageSchema = z.object({
  messageId: z.uuid(),
  channelId: z.uuid(),
});

export type ForwardMessageRequest = z.infer<typeof forwardMessageSchema>;

/** 답장한 원래 메시지를 짧게 보여 주는 정보 */
export interface MessageReference {
  id: string;
  author: UserProfile;
  /** 앞부분만 (REPLY_PREVIEW_LENGTH자) */
  content: string;
  attachmentCount: number;
}

export const REPLY_PREVIEW_LENGTH = 120;

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
  /** 첨부만 보내면 빈 문자열 */
  content: string;
  attachments: AttachmentDto[];
  /** 답장이면 원래 메시지 (지워졌으면 null) */
  replyTo: MessageReference | null;
  /** 다른 곳에서 전달한 메시지 */
  forwarded: boolean;
  createdAt: string;
}

/** 최신 메시지부터 내려준다. hasMore면 마지막 메시지 ID를 before로 다음 페이지를 요청한다. */
export interface MessagePage {
  messages: MessageDto[];
  hasMore: boolean;
}

/**
 * 메타버스 모드에서 이 메시지를 어떻게 보일지.
 * 첨부가 있으면 말풍선 대신 캐릭터 모션으로 보인다 (설계 원칙: 표현 규칙은 공용 코드에 둔다).
 */
export function messagePresentation(
  message: Pick<MessageDto, 'attachments'>,
): 'bubble' | 'attachment-emote' {
  return message.attachments.length > 0 ? 'attachment-emote' : 'bubble';
}
