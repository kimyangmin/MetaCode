import type { RoleDto } from '@metacode/shared';

/** 멤버 이름 색: 가진 역할 중 목록에서 가장 위(position이 작은) 역할의 색. 색이 있는 역할이 없으면 null */
export function memberColor(roleIds: readonly string[], roles: readonly RoleDto[]): string | null {
  const owned = new Set(roleIds);
  const sorted = [...roles].sort((a, b) => a.position - b.position);
  return sorted.find((r) => owned.has(r.id) && r.color)?.color ?? null;
}

/** 역할 이름을 목록 순서대로 */
export function roleNames(roleIds: readonly string[], roles: readonly RoleDto[]): string[] {
  const owned = new Set(roleIds);
  return [...roles]
    .sort((a, b) => a.position - b.position)
    .filter((r) => owned.has(r.id))
    .map((r) => r.name);
}
