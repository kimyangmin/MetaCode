import { hasUnread } from '@metacode/shared';
import { useState } from 'react';
import { NavLink } from 'react-router';
import { initials } from '@metacode/client';
import { useFriends } from '../friends/api';
import { CreateCommunityDialog } from './CreateCommunityDialog';
import { useCommunities, useDms } from './hooks';

/** 가장 왼쪽 세로 막대: DM 홈, 내 커뮤니티들, 커뮤니티 추가 */
export function CommunityRail() {
  const communities = useCommunities();
  const dms = useDms();
  const [creating, setCreating] = useState(false);
  // 안 읽은 DM이나 받은 친구 요청이 있으면 DM에 점을 찍는다.
  const incoming = useFriends().data?.incoming.length ?? 0;
  const dmUnread = (dms.data?.some(hasUnread) ?? false) || incoming > 0;

  return (
    <nav className="rail" aria-label="커뮤니티">
      <NavLink to="/dm" className="rail__item rail__item--home" title="다이렉트 메시지">
        DM
        {dmUnread && <span className="rail__unread" aria-label="안 읽은 메시지" />}
      </NavLink>
      <hr className="rail__divider" />
      {communities.data?.map((c) => (
        <NavLink key={c.id} to={`/c/${c.id}`} className="rail__item" title={c.name}>
          {c.iconUrl ? <img src={c.iconUrl} alt="" /> : initials(c.name)}
          {c.channels.some(hasUnread) && (
            <span className="rail__unread" aria-label="안 읽은 메시지" />
          )}
        </NavLink>
      ))}
      <button
        className="rail__item rail__item--add"
        onClick={() => setCreating(true)}
        title="커뮤니티 만들기 또는 참여하기"
        aria-label="커뮤니티 만들기 또는 참여하기"
      >
        +
      </button>
      {creating && <CreateCommunityDialog onClose={() => setCreating(false)} />}
    </nav>
  );
}
