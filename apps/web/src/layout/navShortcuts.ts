/**
 * Ctrl+1~0으로 화면 옮기기: 1은 DM, 2~9는 왼쪽 목록의 첫 번째~여덟 번째 커뮤니티, 0은 아홉 번째.
 * 글자 자판(한글 등)과 상관없이 숫자 줄의 자리(e.code)로 본다. 옮길 곳이 없으면 null.
 */
export function shortcutTarget(
  e: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>,
  communityIds: readonly string[],
): string | null {
  if (!e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return null;
  const match = /^Digit(\d)$/.exec(e.code);
  if (!match) return null;
  const digit = Number(match[1]);
  if (digit === 1) return '/dm';
  // 2 → 0번째, …, 9 → 7번째, 0 → 8번째
  const index = digit === 0 ? 8 : digit - 2;
  const id = communityIds[index];
  return id ? `/c/${id}` : null;
}
