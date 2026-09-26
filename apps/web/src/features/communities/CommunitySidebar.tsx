import {
  type ChannelSummary,
  type CommunitySummary,
  CommunityRole,
  hasUnread,
} from '@metacode/shared';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { ApiError, apiFetch } from '../../api/client';
import { jsonBody, queryKeys } from '../../api/queries';
import { webUrl } from '../../config';
import { Dialog } from '../../ui/Dialog';
import { UserPanel } from '../auth/UserPanel';
import { useMeRequired } from './hooks';

type Modal = 'invite' | 'channel' | null;

/** 커뮤니티 화면 왼쪽: 이름과 메뉴, 텍스트 채널 목록, 내 프로필 */
export function CommunitySidebar({
  community,
  activeChannelId,
}: {
  community: CommunitySummary;
  activeChannelId: string;
}) {
  const me = useMeRequired();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const isOwner = community.myRole === CommunityRole.Owner;
  const canManage = community.myRole !== CommunityRole.Member;

  const leaveOrDelete = async () => {
    setMenuOpen(false);
    const question = isOwner
      ? `"${community.name}" 커뮤니티를 삭제할까요? 모든 채널과 메시지가 지워집니다.`
      : `"${community.name}" 커뮤니티에서 나갈까요?`;
    if (!window.confirm(question)) return;
    await apiFetch(
      isOwner ? `/communities/${community.id}` : `/communities/${community.id}/leave`,
      {
        method: isOwner ? 'DELETE' : 'POST',
      },
    );
    queryClient.setQueryData<CommunitySummary[]>(queryKeys.communities, (list) =>
      list?.filter((c) => c.id !== community.id),
    );
    navigate('/');
  };

  return (
    <aside className="sidebar">
      <header className="sidebar__header">
        <h2 title={community.name}>{community.name}</h2>
        <button
          className="icon-button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="커뮤니티 메뉴"
          onClick={() => setMenuOpen((v) => !v)}
        >
          ⋯
        </button>
        {menuOpen && (
          <div className="menu" role="menu" onMouseLeave={() => setMenuOpen(false)}>
            <button role="menuitem" onClick={() => (setMenuOpen(false), setModal('invite'))}>
              초대하기
            </button>
            {canManage && (
              <button role="menuitem" onClick={() => (setMenuOpen(false), setModal('channel'))}>
                채널 만들기
              </button>
            )}
            <button role="menuitem" className="menu__danger" onClick={leaveOrDelete}>
              {isOwner ? '커뮤니티 삭제' : '커뮤니티 나가기'}
            </button>
          </div>
        )}
      </header>

      <nav className="sidebar__list" aria-label="채널">
        <h3 className="sidebar__section">텍스트 채널</h3>
        {community.channels
          .filter((c) => c.type === 'TEXT')
          .map((channel) => (
            <ChannelLink
              key={channel.id}
              communityId={community.id}
              channel={channel}
              active={channel.id === activeChannelId}
            />
          ))}
      </nav>

      <UserPanel me={me} />

      {modal === 'invite' && (
        <InviteDialog communityId={community.id} onClose={() => setModal(null)} />
      )}
      {modal === 'channel' && (
        <CreateChannelDialog communityId={community.id} onClose={() => setModal(null)} />
      )}
    </aside>
  );
}

function ChannelLink({
  communityId,
  channel,
  active,
}: {
  communityId: string;
  channel: ChannelSummary;
  active: boolean;
}) {
  const unread = !active && hasUnread(channel);
  return (
    <NavLink to={`/c/${communityId}/${channel.id}`} className="sidebar__item" data-unread={unread}>
      <span className="sidebar__hash">#</span>
      <span className="sidebar__label">{channel.name}</span>
    </NavLink>
  );
}

function InviteDialog({ communityId, onClose }: { communityId: string; onClose(): void }) {
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const create = async () => {
    try {
      const invite = await apiFetch<{ code: string }>(`/communities/${communityId}/invites`, {
        method: 'POST',
      });
      setLink(`${webUrl()}/invite/${invite.code}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '초대 링크를 만들지 못했습니다.');
    }
  };

  return (
    <Dialog title="초대하기" onClose={onClose}>
      <div className="form">
        <p className="form__hint">이 링크를 받은 사람은 7일 동안 커뮤니티에 들어올 수 있습니다.</p>
        {link ? (
          <div className="copy-field">
            <input
              value={link}
              readOnly
              onFocus={(e) => e.target.select()}
              aria-label="초대 링크"
            />
            <button
              className="button button--primary"
              onClick={() => void navigator.clipboard.writeText(link).then(() => setCopied(true))}
            >
              {copied ? '복사됨' : '복사'}
            </button>
          </div>
        ) : (
          <button className="button button--primary" onClick={create}>
            초대 링크 만들기
          </button>
        )}
        {error && <p className="form__error">{error}</p>}
      </div>
    </Dialog>
  );
}

function CreateChannelDialog({ communityId, onClose }: { communityId: string; onClose(): void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const channel = await apiFetch<ChannelSummary>(`/communities/${communityId}/channels`, {
        method: 'POST',
        ...jsonBody({ name }),
      });
      queryClient.setQueryData<CommunitySummary[]>(queryKeys.communities, (list) =>
        list?.map((c) =>
          c.id === communityId && !c.channels.some((ch) => ch.id === channel.id)
            ? { ...c, channels: [...c.channels, channel] }
            : c,
        ),
      );
      onClose();
      navigate(`/c/${communityId}/${channel.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '채널을 만들지 못했습니다.');
    }
  };

  return (
    <Dialog title="텍스트 채널 만들기" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>
          채널 이름
          <div className="input-prefix">
            <span>#</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} required />
          </div>
        </label>
        <p className="form__hint">공백은 하이픈(-)으로, 영문은 소문자로 바뀝니다.</p>
        {error && <p className="form__error">{error}</p>}
        <button className="button button--primary" disabled={!name.trim()}>
          만들기
        </button>
      </form>
    </Dialog>
  );
}
