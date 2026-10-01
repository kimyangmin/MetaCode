import { describe, expect, it } from 'vitest';
import {
  CENTER_MIN,
  MEMBERS_WIDTH_MAX,
  MEMBERS_WIDTH_MIN,
  NAV_COLUMNS,
  clampMembersWidth,
} from './membersWidth';

describe('멤버 목록 폭', () => {
  it('범위(180~420px) 안으로 맞춘다', () => {
    expect(clampMembersWidth(300, 1920, NAV_COLUMNS)).toBe(300);
    expect(clampMembersWidth(50, 1920, NAV_COLUMNS)).toBe(MEMBERS_WIDTH_MIN);
    expect(clampMembersWidth(900, 1920, NAV_COLUMNS)).toBe(MEMBERS_WIDTH_MAX);
  });

  it('창이 좁으면 가운데 영역을 남길 만큼만 넓힌다 (최소 폭은 지킴)', () => {
    const viewport = 1000;
    expect(clampMembersWidth(420, viewport, NAV_COLUMNS)).toBe(viewport - NAV_COLUMNS - CENTER_MIN);
    expect(clampMembersWidth(420, 700, NAV_COLUMNS)).toBe(MEMBERS_WIDTH_MIN);
  });
});
