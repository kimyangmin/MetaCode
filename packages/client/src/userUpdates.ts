import type { UserProfile } from '@metacode/shared';

const isProfileOf = (value: object, id: string): value is UserProfile =>
  (value as UserProfile).id === id &&
  typeof (value as UserProfile).username === 'string' &&
  'avatarUrl' in value;

/**
 * 데이터 안에 들어 있는 이 사용자의 정보(UserProfile 모양: 메시지 작성자, 멤버, 통화 참여자 등)를
 * 새 닉네임·사진·캐릭터로 바꾼다 (`user:updated`). 바뀐 것이 없으면 같은 객체를 그대로 돌려준다
 * (쓸데없이 다시 그리지 않도록). 일반 객체와 배열만 따라 들어간다.
 */
export function withUserProfile<T>(data: T, user: UserProfile): T {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      let changed = false;
      const next = value.map((item) => {
        const updated = visit(item);
        if (updated !== item) changed = true;
        return updated;
      });
      return changed ? next : value;
    }
    if (value === null || typeof value !== 'object') return value;
    if (Object.getPrototypeOf(value) !== Object.prototype) return value;
    if (isProfileOf(value, user.id)) {
      if (
        value.username === user.username &&
        value.displayName === user.displayName &&
        value.avatarUrl === user.avatarUrl &&
        (value.avatarAnimatedUrl ?? null) === (user.avatarAnimatedUrl ?? null) &&
        JSON.stringify(value.character) === JSON.stringify(user.character)
      ) {
        return value;
      }
      return {
        ...value,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        avatarAnimatedUrl: user.avatarAnimatedUrl ?? null,
        character: user.character,
      };
    }
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const updated = visit(item);
      if (updated !== item) changed = true;
      next[key] = updated;
    }
    return changed ? next : value;
  };
  return visit(data) as T;
}
