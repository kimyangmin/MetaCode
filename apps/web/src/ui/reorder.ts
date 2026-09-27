/**
 * 목록에서 dragId를 targetId의 앞(after=false)이나 뒤(after=true)로 옮긴 새 목록.
 * 제자리면 같은 순서를 돌려준다.
 */
export function reorder(
  ids: readonly string[],
  dragId: string,
  targetId: string,
  after: boolean,
): string[] {
  if (dragId === targetId || !ids.includes(dragId) || !ids.includes(targetId)) return [...ids];
  const rest = ids.filter((id) => id !== dragId);
  const index = rest.indexOf(targetId) + (after ? 1 : 0);
  return [...rest.slice(0, index), dragId, ...rest.slice(index)];
}
