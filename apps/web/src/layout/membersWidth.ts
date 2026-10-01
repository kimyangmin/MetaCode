/** 멤버 목록 폭 (px). 넓은 화면에서 왼쪽 가장자리를 끌어 바꾼다 (좁은 화면의 서랍은 따로) */
export const MEMBERS_WIDTH_DEFAULT = 232;
export const MEMBERS_WIDTH_MIN = 180;
export const MEMBERS_WIDTH_MAX = 420;
/** 멤버 목록을 넓혀도 가운데(채팅·광장)에 이만큼은 남긴다 */
export const CENTER_MIN = 300;
/** 멤버 목록 말고 고정된 열: 커뮤니티 막대 72px + 채널 목록 240px (styles.css의 .app 열과 같게) */
export const NAV_COLUMNS = 72 + 240;
/** 키보드(←→)로 한 번에 바꾸는 폭 */
export const MEMBERS_WIDTH_STEP = 16;

/**
 * 멤버 목록 폭을 범위 안으로. 창이 좁으면 가운데 영역이 CENTER_MIN보다 좁아지지 않을 만큼만 넓힌다
 * (otherColumns = 커뮤니티 막대 + 채널 목록처럼 멤버 목록 말고 고정된 폭).
 */
export function clampMembersWidth(
  width: number,
  viewportWidth: number,
  otherColumns: number,
): number {
  const room = viewportWidth - otherColumns - CENTER_MIN;
  const max = Math.max(MEMBERS_WIDTH_MIN, Math.min(MEMBERS_WIDTH_MAX, room));
  return Math.round(Math.min(max, Math.max(MEMBERS_WIDTH_MIN, width)));
}
