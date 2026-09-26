import { describe, expect, it } from 'vitest';
import { channelNameSchema, createDmSchema, hasUnread } from './channel.js';

describe('channelNameSchema', () => {
  it('공백은 하이픈으로, 영문은 소문자로 맞추고 한글은 그대로 둔다', () => {
    expect(channelNameSchema.parse('  General Chat  ')).toBe('general-chat');
    expect(channelNameSchema.parse('자유 게시판')).toBe('자유-게시판');
  });

  it('비었거나 30자를 넘으면 거절한다', () => {
    expect(channelNameSchema.safeParse('   ').success).toBe(false);
    expect(channelNameSchema.safeParse('a'.repeat(31)).success).toBe(false);
  });
});

describe('createDmSchema', () => {
  it('같은 상대가 중복되면 한 번만 남긴다', () => {
    const id = '0190a8a0-0000-7000-8000-000000000001';
    expect(createDmSchema.parse({ userIds: [id, id] }).userIds).toEqual([id]);
  });
});

describe('hasUnread', () => {
  it('마지막 메시지가 마지막으로 읽은 메시지보다 새것이면 안 읽음', () => {
    const older = '0190a8a0-0000-7000-8000-000000000001';
    const newer = '0190a8a0-0001-7000-8000-000000000001';
    expect(hasUnread({ lastMessageId: newer, lastReadMessageId: older })).toBe(true);
    expect(hasUnread({ lastMessageId: newer, lastReadMessageId: newer })).toBe(false);
    expect(hasUnread({ lastMessageId: newer, lastReadMessageId: null })).toBe(true);
    expect(hasUnread({ lastMessageId: null, lastReadMessageId: null })).toBe(false);
  });
});
