import { describe, expect, it } from 'vitest';
import { parseInviteCode } from './invite.js';

describe('parseInviteCode', () => {
  it('코드만, 웹 링크, 데스크톱 해시 링크 모두에서 코드를 꺼낸다', () => {
    expect(parseInviteCode('7eWKjLfS')).toBe('7eWKjLfS');
    expect(parseInviteCode('  https://metacode.kimyangmin.me/invite/7eWKjLfS  ')).toBe('7eWKjLfS');
    expect(parseInviteCode('http://localhost:5173/invite/7eWKjLfS/')).toBe('7eWKjLfS');
    expect(parseInviteCode('file:///app/index.html#/invite/7eWKjLfS')).toBe('7eWKjLfS');
  });

  it('코드가 아닌 입력은 거절한다', () => {
    expect(parseInviteCode('')).toBeNull();
    expect(parseInviteCode('https://example.com/other/path!')).toBeNull();
    expect(parseInviteCode('초대코드')).toBeNull();
  });
});
