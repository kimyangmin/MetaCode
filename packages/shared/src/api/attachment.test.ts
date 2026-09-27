import { describe, expect, it } from 'vitest';
import { attachmentPath, createUploadSchema, isBlockedFileName } from './attachment.js';
import { messagePresentation, sendMessageSchema } from './message.js';

const channelId = '0190a8a0-0000-7000-8000-000000000001';
const attachmentId = '0190a8a0-0000-7000-8000-000000000002';

describe('첨부 파일 이름 검사', () => {
  it('실행 파일은 대소문자와 상관없이 막고, 코드 파일은 허용한다', () => {
    expect(isBlockedFileName('setup.EXE')).toBe(true);
    expect(isBlockedFileName('run.bat')).toBe(true);
    expect(isBlockedFileName('main.ts')).toBe(false);
    expect(isBlockedFileName('deploy.sh')).toBe(false);
    expect(isBlockedFileName('README')).toBe(false);
  });

  it('경로 문자나 제어 문자가 든 이름은 거절한다', () => {
    const parse = (fileName: string) =>
      createUploadSchema.safeParse({ channelId, fileName, size: 1 }).success;
    expect(parse('보고서.pdf')).toBe(true);
    expect(parse('../etc/passwd')).toBe(false);
    expect(parse('a\b.txt')).toBe(false);
    expect(parse('a\nb.txt')).toBe(false);
    expect(parse('virus.exe')).toBe(false);
  });
});

describe('메시지 보내기 형식', () => {
  it('글이나 첨부 중 하나는 있어야 한다', () => {
    expect(sendMessageSchema.safeParse({ channelId, content: '  ' }).success).toBe(false);
    expect(
      sendMessageSchema.safeParse({ channelId, content: '', attachmentIds: [attachmentId] })
        .success,
    ).toBe(true);
    expect(sendMessageSchema.safeParse({ channelId, content: '안녕' }).success).toBe(true);
  });

  it('같은 첨부가 중복되면 한 번만 남기고, 11개 이상은 거절한다', () => {
    const parsed = sendMessageSchema.parse({
      channelId,
      attachmentIds: [attachmentId, attachmentId],
    });
    expect(parsed.attachmentIds).toEqual([attachmentId]);
    const many = Array.from(
      { length: 11 },
      (_, i) => `0190a8a0-0000-7000-8000-0000000001${String(i).padStart(2, '0')}`,
    );
    expect(sendMessageSchema.safeParse({ channelId, attachmentIds: many }).success).toBe(false);
  });
});

describe('표현 규칙과 경로', () => {
  it('첨부가 있으면 메타버스 모드에서 말풍선 대신 캐릭터 모션', () => {
    expect(messagePresentation({ attachments: [] })).toBe('bubble');
    expect(
      messagePresentation({
        attachments: [
          {
            id: attachmentId,
            fileName: 'a.png',
            contentType: 'image/png',
            size: 1,
            kind: 'image',
            width: 1,
            height: 1,
          },
        ],
      }),
    ).toBe('attachment-emote');
  });

  it('첨부 경로에 변형과 다운로드 여부를 붙인다', () => {
    expect(attachmentPath(attachmentId)).toBe(`/attachments/${attachmentId}`);
    expect(attachmentPath(attachmentId, { variant: 'thumbnail' })).toBe(
      `/attachments/${attachmentId}?variant=thumbnail`,
    );
    expect(attachmentPath(attachmentId, { download: true })).toBe(
      `/attachments/${attachmentId}?download=1`,
    );
  });
});
