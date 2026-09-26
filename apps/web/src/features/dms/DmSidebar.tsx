import { type DmSummary, type UserProfile, hasUnread } from '@metacode/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { NavLink } from 'react-router';
import { apiFetch } from '../../api/client';
import { Avatar } from '../../ui/Avatar';
import { Dialog } from '../../ui/Dialog';
import { displayName, dmTitle } from '../../ui/format';
import { UserPanel } from '../auth/UserPanel';
import { useDms, useMeRequired, useOpenDm } from '../communities/hooks';

/** DM 화면 왼쪽: 대화 목록과 새 대화 */
export function DmSidebar({ activeId }: { activeId?: string }) {
  const me = useMeRequired();
  const dms = useDms();
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
  return (
    <NavLink
      to={`/dm/${dm.id}`}
      className="sidebar__item sidebar__item--dm"
      data-unread={!active && hasUnread(dm)}
    >
      {first && <Avatar user={first} size={28} showStatus={dm.type === 'DM'} />}
      <span className="sidebar__label">{dmTitle(dm, meId)}</span>
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

  const results = useQuery({
    queryKey: ['user-search', debounced],
    queryFn: () => apiFetch<UserProfile[]>(`/users/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length > 0,
  });

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
          GitHub 아이디로 찾기
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="예: octocat"
          />
        </label>
        {selected.length > 0 && (
          <div className="chips">
            {selected.map((u) => (
              <button key={u.id} className="chip" onClick={() => toggle(u)}>
                {displayName(u)} ×
              </button>
            ))}
          </div>
        )}
        <ul className="search-results">
          {results.data?.map((user) => (
            <li key={user.id}>
              <label className="search-results__item">
                <input
                  type="checkbox"
                  checked={selected.some((u) => u.id === user.id)}
                  onChange={() => toggle(user)}
                />
                <Avatar user={user} size={28} />
                <span>
                  {displayName(user)} <small>@{user.username}</small>
                </span>
              </label>
            </li>
          ))}
          {debounced && results.data?.length === 0 && (
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
