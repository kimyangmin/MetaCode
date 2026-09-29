import { hasUnread } from '@metacode/shared';
import { Menu } from 'lucide-react';
import { useCommunities, useDms } from '../features/communities/hooks';
import { useUiStore } from '../stores/ui';

/**
 * 휴대폰 화면의 머리글 왼쪽 ☰: 커뮤니티·채널 목록 서랍을 연다 (넓은 화면에서는 CSS로 숨김).
 * 다른 곳에 안 읽은 메시지가 있으면 점을 찍는다.
 */
export function NavButton() {
  const open = useUiStore((s) => s.navOpen);
  const setNavOpen = useUiStore((s) => s.setNavOpen);
  const communities = useCommunities().data;
  const dms = useDms().data;
  const unread =
    (communities?.some((c) => c.channels.some(hasUnread)) ?? false) ||
    (dms?.some(hasUnread) ?? false);
  return (
    <button
      type="button"
      className="icon-button nav-button"
      aria-label="커뮤니티·채널 목록"
      aria-expanded={open}
      onClick={() => setNavOpen(!open)}
    >
      <Menu aria-hidden />
      {unread && <span className="nav-button__unread" aria-label="안 읽은 메시지" />}
    </button>
  );
}
