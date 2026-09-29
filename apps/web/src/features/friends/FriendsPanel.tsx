import type { FriendDto, FriendRequestDto } from '@metacode/shared';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useState } from 'react';
import { ApiError } from '../../api/client';
import { useIsOnline, usePresenceStore } from '../../stores/presence';
import { Avatar } from '../../ui/Avatar';
import { displayName } from '../../ui/format';
import { useOpenDm } from '../communities/hooks';
import { acceptFriend, removeFriend, sendFriendRequest, useFriends } from './api';
import { MessageCircle, UserMinus, Users } from 'lucide-react';
import { NavButton } from '../../layout/NavButton';

type Tab = 'online' | 'all' | 'pending' | 'add';

/**
 * DM 홈(대화를 고르지 않았을 때)의 친구 화면: 온라인 · 모두 · 대기 중 · 친구 추가.
 * 친구에게 바로 메시지를 보내거나 끊고, 받은 요청은 수락·거절, 보낸 요청은 취소한다.
 */
export function FriendsPanel() {
  const friends = useFriends();
  const all = friends.data?.friends ?? [];
  // 온라인인 친구 id만 문자열로 뽑아 구독한다 (다른 사람의 접속 변화에는 다시 그리지 않게).
  const onlineKey = usePresenceStore((s) =>
    all
      .filter((f) => s.online[f.user.id])
      .map((f) => f.user.id)
      .join(','),
  );
  const online = all.filter((f) => onlineKey.split(',').includes(f.user.id));
  const pending = (friends.data?.incoming.length ?? 0) + (friends.data?.outgoing.length ?? 0);
  const incoming = friends.data?.incoming.length ?? 0;
  const [tab, setTab] = useState<Tab>(() => (incoming > 0 ? 'pending' : 'online'));

  const tabs: { id: Tab; label: ReactNode }[] = [
    { id: 'online', label: '온라인' },
    { id: 'all', label: '모두' },
    {
      id: 'pending',
      label: <>대기 중{incoming > 0 && <span className="friends__badge">{incoming}</span>}</>,
    },
    { id: 'add', label: '친구 추가' },
  ];

  const list = friends.data;
  return (
    <section className="chat friends" aria-label="친구">
      <header className="chat__header friends__header">
        <NavButton />
        <h2 className="inline-icon">
          <Users aria-hidden /> 친구
        </h2>
        <div className="friends__tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              data-add={t.id === 'add'}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>
      <div className="friends__body">
        {friends.isPending && <p className="form__hint">불러오는 중…</p>}
        {list && tab === 'online' && (
          <FriendList
            title={`온라인 — ${online.length}명`}
            friends={online}
            empty="지금 온라인인 친구가 없습니다."
          />
        )}
        {list && tab === 'all' && (
          <FriendList
            title={`모든 친구 — ${list.friends.length}명`}
            friends={list.friends}
            empty="아직 친구가 없습니다. 친구 추가에서 사용자 ID로 요청해 보세요."
          />
        )}
        {list && tab === 'pending' && (
          <>
            <RequestList
              title={`받은 요청 — ${list.incoming.length}`}
              requests={list.incoming}
              incoming
            />
            <RequestList title={`보낸 요청 — ${list.outgoing.length}`} requests={list.outgoing} />
            {pending === 0 && <p className="friends__empty">대기 중인 친구 요청이 없습니다.</p>}
          </>
        )}
        {tab === 'add' && <AddFriend />}
      </div>
    </section>
  );
}

function FriendList({
  title,
  friends,
  empty,
}: {
  title: string;
  friends: FriendDto[];
  empty: string;
}) {
  return (
    <>
      <h3 className="friends__section">{title}</h3>
      {friends.length === 0 ? (
        <p className="friends__empty">{empty}</p>
      ) : (
        <ul className="friends__list">
          {friends.map((friend) => (
            <FriendRow key={friend.user.id} friend={friend} />
          ))}
        </ul>
      )}
    </>
  );
}

function FriendRow({ friend }: { friend: FriendDto }) {
  const queryClient = useQueryClient();
  const openDm = useOpenDm();
  const online = useIsOnline(friend.user.id);
  const { user } = friend;
  return (
    <li className="friends__row">
      <Avatar user={user} size={36} showStatus />
      <span className="friends__names">
        <strong>{displayName(user)}</strong>
        <small>
          @{user.username} · {online ? '온라인' : '오프라인'}
        </small>
      </span>
      <span className="friends__actions">
        <button
          type="button"
          className="icon-button"
          title="메시지 보내기"
          aria-label={`${displayName(user)}에게 메시지 보내기`}
          onClick={() => void openDm([user.id])}
        >
          <MessageCircle aria-hidden />
        </button>
        <button
          type="button"
          className="icon-button"
          title="친구 끊기"
          aria-label={`${displayName(user)} 친구 끊기`}
          onClick={() => {
            if (window.confirm(`${displayName(user)} 님과 친구를 끊을까요?`)) {
              void removeFriend(queryClient, user.id);
            }
          }}
        >
          <UserMinus aria-hidden />
        </button>
      </span>
    </li>
  );
}

function RequestList({
  title,
  requests,
  incoming = false,
}: {
  title: string;
  requests: FriendRequestDto[];
  incoming?: boolean;
}) {
  const queryClient = useQueryClient();
  if (requests.length === 0) return null;
  return (
    <>
      <h3 className="friends__section">{title}</h3>
      <ul className="friends__list">
        {requests.map(({ user }) => (
          <li key={user.id} className="friends__row">
            <Avatar user={user} size={36} showStatus />
            <span className="friends__names">
              <strong>{displayName(user)}</strong>
              <small>
                @{user.username} · {incoming ? '받은 요청' : '보낸 요청'}
              </small>
            </span>
            <span className="friends__actions">
              {incoming && (
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => void acceptFriend(queryClient, user.id)}
                >
                  수락
                </button>
              )}
              <button
                type="button"
                className="button"
                onClick={() => void removeFriend(queryClient, user.id)}
              >
                {incoming ? '거절' : '취소'}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function AddFriend() {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState('');
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const name = username.trim().replace(/^@/, '');
    if (!name) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await sendFriendRequest(queryClient, name);
      setStatus({
        kind: 'ok',
        text:
          result.status === 'friends'
            ? `@${name} 님이 먼저 요청해 두어서 바로 친구가 되었습니다.`
            : `@${name} 님에게 친구 요청을 보냈습니다.`,
      });
      setUsername('');
    } catch (err) {
      setStatus({
        kind: 'error',
        text: err instanceof ApiError ? err.message : '친구 요청을 보내지 못했습니다.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="friends__add" onSubmit={(e) => void submit(e)}>
      <h3 className="friends__section">친구 추가</h3>
      <p className="form__hint">사용자 ID(GitHub 아이디)로 친구 요청을 보냅니다.</p>
      <div className="settings__row">
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="예: octocat"
          aria-label="친구의 사용자 ID"
          maxLength={40}
        />
        <button className="button button--primary" disabled={busy || !username.trim()}>
          친구 요청 보내기
        </button>
      </div>
      {status && (
        <p className={status.kind === 'ok' ? 'form__ok' : 'form__error'} role="status">
          {status.text}
        </p>
      )}
    </form>
  );
}
