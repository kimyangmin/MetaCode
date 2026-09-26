import type { DmSummary, UserProfile } from '@metacode/shared';

export const displayName = (user: Pick<UserProfile, 'displayName' | 'username'>) =>
  user.displayName ?? user.username;

/** DM 제목: 나를 뺀 참여자 이름 */
export function dmTitle(dm: DmSummary, meId: string): string {
  const others = dm.participants.filter((p) => p.id !== meId);
  return others.map(displayName).join(', ') || '나';
}

const timeFormat = new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'short',
});

export const formatTime = (iso: string) => timeFormat.format(new Date(iso));
export const formatDay = (iso: string) => dayFormat.format(new Date(iso));
export const sameDay = (a: string, b: string) =>
  new Date(a).toDateString() === new Date(b).toDateString();

/** 커뮤니티 아이콘에 쓸 글자: 이름의 첫 두 글자 */
export const initials = (name: string) => [...name.trim()].slice(0, 2).join('');
