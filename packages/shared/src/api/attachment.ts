import { z } from 'zod';

/** 메시지 하나에 붙일 수 있는 첨부 수 */
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

/**
 * 실행 파일은 받지 않는다 (확장자 기준, 대소문자 무시).
 * 개발자끼리 코드(.js, .sh 등)를 주고받는 경우가 많아 스크립트 파일은 막지 않는다.
 */
export const BLOCKED_FILE_EXTENSIONS = [
  'exe',
  'msi',
  'msix',
  'bat',
  'cmd',
  'com',
  'scr',
  'pif',
  'cpl',
  'vbs',
  'vbe',
  'wsf',
  'wsh',
  'hta',
  'lnk',
  'reg',
] as const;

export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase();
}

export function isBlockedFileName(fileName: string): boolean {
  return (BLOCKED_FILE_EXTENSIONS as readonly string[]).includes(fileExtension(fileName));
}

/** 경로 구분자(/, \)나 제어 문자(줄바꿈 등)가 있는 이름 */
function hasUnsafeChar(name: string): boolean {
  return [...name].some((c) => c === '/' || c === '\\' || c.charCodeAt(0) < 0x20);
}

export const createUploadSchema = z.object({
  channelId: z.uuid(),
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((name) => !hasUnsafeChar(name), '파일 이름에 쓸 수 없는 문자가 있습니다.')
    .refine((name) => !isBlockedFileName(name), '실행 파일은 올릴 수 없습니다.'),
  /** 바이트. 최대 크기는 서버 설정(UPLOAD_MAX_SIZE_MB)으로 검사한다. */
  size: z.number().int().positive(),
});

export type CreateUploadRequest = z.infer<typeof createUploadSchema>;

/** 파일을 저장소에 직접 올릴 주소. headers를 그대로 붙여 PUT해야 서명이 맞는다. */
export interface UploadTicket {
  attachmentId: string;
  uploadUrl: string;
  headers: Record<string, string>;
  expiresAt: string;
}

export type AttachmentKind = 'image' | 'file';

export interface AttachmentDto {
  id: string;
  fileName: string;
  /** 이미지면 실제 형식(image/png 등), 아니면 application/octet-stream */
  contentType: string;
  size: number;
  kind: AttachmentKind;
  /** 이미지 원본 크기 (화면이 밀리지 않게 자리를 미리 잡는 데 쓴다) */
  width: number | null;
  height: number | null;
}

/** 첨부 파일을 받을 API 경로. 앞에 API 주소를 붙여 쓴다. */
export function attachmentPath(
  attachmentId: string,
  options: { variant?: 'original' | 'thumbnail'; download?: boolean } = {},
): string {
  const params = new URLSearchParams();
  if (options.variant === 'thumbnail') params.set('variant', 'thumbnail');
  if (options.download) params.set('download', '1');
  const query = params.toString();
  return `/attachments/${attachmentId}${query ? `?${query}` : ''}`;
}

export const attachmentQuerySchema = z.object({
  variant: z.enum(['original', 'thumbnail']).default('original'),
  download: z
    .enum(['0', '1'])
    .optional()
    .transform((v) => v === '1'),
});

export type AttachmentQuery = z.infer<typeof attachmentQuerySchema>;

/** GET /attachments/:id/link: 권한을 확인한 짧게 유효한 저장소 주소 (안드로이드 앱의 받기) */
export interface AttachmentLink {
  url: string;
}
