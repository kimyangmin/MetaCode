import { describe, expect, it } from 'vitest';
import { SHEET_CLOSE_DISTANCE, sheetDragOffset, shouldCloseSheet } from './profileSheet';

describe('사용자 정보 시트 끌어내리기', () => {
  it('위로 끈 것은 움직이지 않는다', () => {
    expect(sheetDragOffset(-40)).toBe(0);
    expect(sheetDragOffset(30)).toBe(30);
  });

  it('충분히 내리면 천천히 내려도 닫는다', () => {
    expect(shouldCloseSheet(SHEET_CLOSE_DISTANCE, 2000)).toBe(true);
    expect(shouldCloseSheet(SHEET_CLOSE_DISTANCE - 1, 2000)).toBe(false);
  });

  it('짧게 끌어도 빠르게 툭 내리면 닫는다', () => {
    expect(shouldCloseSheet(40, 50)).toBe(true);
    expect(shouldCloseSheet(40, 400)).toBe(false);
  });

  it('살짝 건드린 것은 빨라도 닫지 않는다', () => {
    expect(shouldCloseSheet(8, 5)).toBe(false);
  });
});
