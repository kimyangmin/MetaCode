import { type DmSummary, type UserProfile, hasUnread } from '@metacode/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { NavLink } from 'react-router';
import { apiFetch } from '../../api/client';
import { Avatar } from '../../ui/Avatar';
import { Dialog } from '../../ui/Dialog';
import { displayName, dmTitle } from '@metacode/client';
import { UserPanel } from '../auth/UserPanel';
import { useDms, useMeRequired, useOpenDm } from '../communities/hooks';
import { useFriends } from '../friends/api';
import { useCall } from '../voice/store';
import { Users, Volume2, X } from 'lucide-react';

/** DM 화면 왼쪽: 대화 목록과 새 대화 */
export function DmSidebar({ activeId }: { activeId?: string }) {
  const me = useMeRequired();
  const dms = useDms();
  const friends = useFriends();
  const incoming = friends.data?.incoming.length ?? 0;
  const [creating, setCreating] = useState(false);

  return (
    <aside className="sidebar">
      <header className="sidebar__header">
        <h2>다이렉트 메시지</h2>
        <button
          className="icon-button"
          onClick={() => setCreating(true)}
          aria-label="새 대화"
          title="새 대화"
        >
          +
        </button>
      </header>
      <nav className="sidebar__list" aria-label="대화">
        <NavLink to="/dm" end className="sidebar__item sidebar__item--friends">
          <Users aria-hidden />
          <span className="sidebar__label">친구</span>
          {incoming > 0 && (
            <span className="friends__badge" aria-label={`받은 친구 요청 ${incoming}개`}>
              {incoming}
            </span>
          )}
        </NavLink>
        <h3 className="sidebar__section">다이렉트 메시지</h3>
        {dms.data?.length === 0 && (
          <p className="sidebar__empty">아직 대화가 없습니다. + 를 눌러 시작해 보세요.</p>
        )}
        {dms.data?.map((dm) => (
          <DmLink key={dm.id} dm={dm} meId={me.id} active={dm.id === activeId} />
        ))}
      </nav>
      <UserPanel me={me} />
      {creating && <NewDmDialog onClose={() => setCreating(false)} />}
    </aside>
  );
}

function DmLink({ dm, meId, active }: { dm: DmSummary; meId: string; active: boolean }) {
  const others = dm.participants.filter((p) => p.id !== meId);
  const first = others[0];
  const call = useCall(dm.id);
  return (
    <NavLink
      to={`/dm/${dm.id}`}
      className="sidebar__item sidebar__item--dm"
      data-unread={!active && hasUnread(dm)}
    >
      {first && <Avatar user={first} size={28} showStatus={dm.type === 'DM'} animate />}
      <span className="sidebar__label">{dmTitle(dm, meId)}</span>
      {call && (
        <span className="sidebar__live" title={`통화 중 ${call.members.length}명`}>
          <Volume2 role="img" aria-label={`통화 중 ${call.members.length}명`} />
        </span>
      )}
      {dm.type === 'GROUP_DM' && <span className="sidebar__count">{dm.participants.length}</span>}
    </NavLink>
  );
}

function NewDmDialog({ onClose }: { onClose(): void }) {
  const openDm = useOpenDm();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selected, setSelected] = useState<UserProfile[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const friends = useFriends().data?.friends ?? [];
  // 친구는 검색하지 않아도 보이고, 입력한 글자로 이름·ID를 거른다. 검색 결과에서는 친구를 뺀다.
  const needle = query.trim().toLowerCase();
  const shownFriends = friends
    .map((f) => f.user)
    .filter(
      (u) =>
        !needle ||
        u.username.toLowerCase().includes(needle) ||
        displayName(u).toLowerCase().includes(needle),
    );
  const friendIds = new Set(friends.map((f) => f.user.id));

  const results = useQuery({
    queryKey: ['user-search', debounced],
    queryFn: () => apiFetch<UserProfile[]>(`/users/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length > 0,
  });

  const others = (results.data ?? []).filter((user) => !friendIds.has(user.id));

  const toggle = (user: UserProfile) =>
    setSelected((list) =>
      list.some((u) => u.id === user.id)
        ? list.filter((u) => u.id !== user.id)
        : list.length < 9
          ? [...list, user]
          : list,
    );

  return (
    <Dialog title="새 대화" onClose={onClose}>
      <div className="form">
        <label>
          친구나 GitHub 아이디로 찾기
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="예: octocat"
          />
        </label>
        {selected.length > 0 && (
          <div className="chips">
            {selected.map((u) => (
              <button
                key={u.id}
                className="chip"
                onClick={() => toggle(u)}
                aria-label={`${displayName(u)} 빼기`}
              >
                {displayName(u)} <X aria-hidden />
              </button>
            ))}
          </div>
        )}
        {shownFriends.length > 0 && (
          <>
            <h3 className="search-results__title">친구</h3>
            <ul className="search-results">
              {shownFriends.map((user) => (
                <UserPick
                  key={user.id}
                  user={user}
                  checked={selected.some((u) => u.id === user.id)}
                  onToggle={() => toggle(user)}
                />
              ))}
            </ul>
          </>
        )}
        {debounced && <h3 className="search-results__title">다른 사용자</h3>}
        <ul className="search-results">
          {others.map((user) => (
            <UserPick
              key={user.id}
              user={user}
              checked={selected.some((u) => u.id === user.id)}
              onToggle={() => toggle(user)}
            />
          ))}
          {debounced && others.length === 0 && shownFriends.length === 0 && (
            <li className="form__hint">
              찾는 사용자가 없습니다. MetaCode에 로그인한 적이 있어야 합니다.
            </li>
          )}
        </ul>
        <p className="form__hint">2명 이상 고르면 그룹 대화가 됩니다 (최대 10명).</p>
        <button
          className="button button--primary"
          disabled={selected.length === 0}
          onClick={async () => {
            await openDm(selected.map((u) => u.id));
            onClose();
          }}
        >
          대화 시작
        </button>
      </div>
    </Dialog>
  );
}

/** 새 대화에서 고를 사람 한 줄 */
function UserPick({
  user,
  checked,
  onToggle,
}: {
  user: UserProfile;
  checked: boolean;
  onToggle(): void;
}) {
  return (
    <li>
      <label className="search-results__item">
        <input type="checkbox" checked={checked} onChange={onToggle} />
        <Avatar user={user} size={28} showStatus animate />
        <span>
          {displayName(user)} <small>@{user.username}</small>
        </span>
      </label>
    </li>
  );
}
