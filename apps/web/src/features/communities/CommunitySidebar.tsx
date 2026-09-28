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
import { useDragSort } from '../../ui/useDragSort';
import { UserPanel } from '../auth/UserPanel';
import { useCall, useVoiceStore } from '../voice/store';
import { VoiceMembers } from '../voice/VoiceMembers';
import { useVoice } from '../voice/VoiceProvider';
import { ChannelAccessFields, ChannelSettings } from './ChannelSettings';
import { CommunitySettings } from './CommunitySettings';
import { useMeRequired } from './hooks';

type Modal = 'invite' | 'channel' | 'settings' | { edit: ChannelSummary } | null;

/** 커뮤니티 화면 왼쪽: 이름과 메뉴, 텍스트 채널과 음성 채널 목록, 내 프로필 */
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
  const textChannels = community.channels.filter((c) => c.type === 'TEXT');
  const voiceChannels = community.channels.filter((c) => c.type === 'VOICE');

  // 채널 끌어서 순서 바꾸기 (관리자). 텍스트와 음성은 각자 구역 안에서만 옮긴다.
  const saveOrder = (ids: string[]) => {
    const byId = new Map(community.channels.map((c) => [c.id, c]));
    queryClient.setQueryData<CommunitySummary[]>(queryKeys.communities, (list) =>
      list?.map((c) =>
        c.id === community.id ? { ...c, channels: ids.map((id) => byId.get(id)!) } : c,
      ),
    );
    void apiFetch(`/communities/${community.id}/channels/order`, {
      method: 'PUT',
      ...jsonBody({ ids }),
    }).catch(() => queryClient.invalidateQueries({ queryKey: queryKeys.communities }));
  };
  const textIds = textChannels.map((c) => c.id);
  const voiceIds = voiceChannels.map((c) => c.id);
  const textSort = useDragSort(textIds, (ids) => saveOrder([...ids, ...voiceIds]), canManage);
  const voiceSort = useDragSort(voiceIds, (ids) => saveOrder([...textIds, ...ids]), canManage);

  // 소유자는 나갈 수 없다 (커뮤니티 삭제는 커뮤니티 설정 → 일반에서 이름을 입력해서 한다).
  const leave = async () => {
    setMenuOpen(false);
    if (!window.confirm(`"${community.name}" 커뮤니티에서 나갈까요?`)) return;
    await apiFetch(`/communities/${community.id}/leave`, { method: 'POST' });
    queryClient.setQueryData<CommunitySummary[]>(queryKeys.communities, (list) =>
      list?.filter((c) => c.id !== community.id),
    );
    navigate('/');
  };

  return (
    <aside className="sidebar">
      {community.bannerUrl && (
        <div className="sidebar__banner">
          <img src={community.bannerUrl} alt="" />
        </div>
      )}
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
            {canManage && (
              <button role="menuitem" onClick={() => (setMenuOpen(false), setModal('settings'))}>
                커뮤니티 설정
              </button>
            )}
            {!isOwner && (
              <button role="menuitem" className="menu__danger" onClick={() => void leave()}>
                커뮤니티 나가기
              </button>
            )}
          </div>
        )}
      </header>

      <nav className="sidebar__list" aria-label="채널">
        <h3 className="sidebar__section">텍스트 채널</h3>
        {textChannels.map((channel) => (
          <ChannelLink
            key={channel.id}
            sortProps={textSort.itemProps(channel.id)}
            communityId={community.id}
            channel={channel}
            active={channel.id === activeChannelId}
            onEdit={canManage ? () => setModal({ edit: channel }) : undefined}
          />
        ))}
        {voiceChannels.length > 0 && <h3 className="sidebar__section">음성 채널</h3>}
        {voiceChannels.map((channel) => (
          <VoiceChannelItem
            key={channel.id}
            sortProps={voiceSort.itemProps(channel.id)}
            channel={channel}
            onEdit={canManage ? () => setModal({ edit: channel }) : undefined}
          />
        ))}
      </nav>

      <UserPanel me={me} />

      {modal === 'invite' && (
        <InviteDialog communityId={community.id} onClose={() => setModal(null)} />
      )}
      {modal === 'channel' && (
        <CreateChannelDialog community={community} onClose={() => setModal(null)} />
      )}
      {modal === 'settings' && (
        <CommunitySettings community={community} onClose={() => setModal(null)} />
      )}
      {modal && typeof modal === 'object' && (
        <ChannelSettings
          community={community}
          channel={modal.edit}
          onClose={() => setModal(null)}
        />
      )}
    </aside>
  );
}

function ChannelLink({
  communityId,
  channel,
  active,
  onEdit,
  sortProps,
}: {
  communityId: string;
  channel: ChannelSummary;
  active: boolean;
  sortProps: SortProps;
  /** 관리자면 채널 설정 버튼을 보인다 */
  onEdit?: () => void;
}) {
  const unread = !active && hasUnread(channel);
  return (
    <div className="channel-row" {...sortProps}>
      <NavLink
        to={`/c/${communityId}/${channel.id}`}
        className="sidebar__item"
        data-unread={unread}
        // 링크 자체가 끌리면 순서 바꾸기 대신 주소가 끌린다.
        draggable={false}
      >
        <span className="sidebar__hash">#</span>
        <span className="sidebar__label">{channel.name}</span>
        {channel.private && <PrivateMark />}
      </NavLink>
      {onEdit && <EditButton name={channel.name ?? ''} onClick={onEdit} />}
    </div>
  );
}

function PrivateMark() {
  return (
    <span className="sidebar__lock" role="img" aria-label="비공개" title="비공개 채널">
      🔒
    </span>
  );
}

function EditButton({ name, onClick }: { name: string; onClick(): void }) {
  return (
    <button
      type="button"
      className="icon-button channel-row__edit"
      onClick={onClick}
      aria-label={`${name} 채널 설정`}
      title="채널 설정"
    >
      ⚙
    </button>
  );
}

/** 음성 채널: 누르면 통화에 들어간다 (보던 텍스트 채널은 그대로). 아래에 참여자를 보여 준다 */
type SortProps = ReturnType<ReturnType<typeof useDragSort>['itemProps']>;

function VoiceChannelItem({
  channel,
  onEdit,
  sortProps,
}: {
  channel: ChannelSummary;
  onEdit?: () => void;
  sortProps: SortProps;
}) {
  const voice = useVoice();
  const call = useCall(channel.id);
  const joined = useVoiceStore((s) => s.session?.channelId === channel.id);
  return (
    <div className="voice-channel" {...sortProps}>
      <div className="channel-row">
        <button
          type="button"
          className="sidebar__item sidebar__item--voice"
          data-joined={joined}
          onClick={() => void voice.join(channel.id)}
          title={joined ? '통화 중' : '눌러서 통화에 들어가기'}
        >
          <span className="sidebar__hash" aria-hidden>
            🔊
          </span>
          <span className="sidebar__label">{channel.name}</span>
          {channel.private && <PrivateMark />}
        </button>
        {onEdit && <EditButton name={channel.name ?? ''} onClick={onEdit} />}
      </div>
      <VoiceMembers channelId={channel.id} members={call?.members ?? []} />
    </div>
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

function CreateChannelDialog({
  community,
  onClose,
}: {
  community: CommunitySummary;
  onClose(): void;
}) {
  const communityId = community.id;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [type, setType] = useState<'TEXT' | 'VOICE'>('TEXT');
  const [access, setAccess] = useState({ isPrivate: false, roleIds: [] as string[] });
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const channel = await apiFetch<ChannelSummary>(`/communities/${communityId}/channels`, {
        method: 'POST',
        ...jsonBody({ name, type, private: access.isPrivate, roleIds: access.roleIds }),
      });
      queryClient.setQueryData<CommunitySummary[]>(queryKeys.communities, (list) =>
        list?.map((c) =>
          c.id === communityId && !c.channels.some((ch) => ch.id === channel.id)
            ? { ...c, channels: [...c.channels, channel] }
            : c,
        ),
      );
      onClose();
      // 음성 채널은 만들어도 보던 텍스트 채널에 그대로 있는다.
      if (channel.type === 'TEXT') navigate(`/c/${communityId}/${channel.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '채널을 만들지 못했습니다.');
    }
  };

  return (
    <Dialog title="채널 만들기" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <fieldset className="channel-type">
          <legend>종류</legend>
          <label>
            <input
              type="radio"
              name="channel-type"
              checked={type === 'TEXT'}
              onChange={() => setType('TEXT')}
            />
            <span># 텍스트</span>
            <small>메시지, 파일, 대화 기록</small>
          </label>
          <label>
            <input
              type="radio"
              name="channel-type"
              checked={type === 'VOICE'}
              onChange={() => setType('VOICE')}
            />
            <span>🔊 음성</span>
            <small>누르면 바로 들어가는 통화</small>
          </label>
        </fieldset>
        <label>
          채널 이름
          <div className="input-prefix">
            <span>{type === 'TEXT' ? '#' : '🔊'}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} required />
          </div>
        </label>
        <p className="form__hint">공백은 하이픈(-)으로, 영문은 소문자로 바뀝니다.</p>
        <ChannelAccessFields
          roles={community.roles}
          isPrivate={access.isPrivate}
          roleIds={access.roleIds}
          onChange={setAccess}
        />
        {error && <p className="form__error">{error}</p>}
        <button className="button button--primary" disabled={!name.trim()}>
          만들기
        </button>
      </form>
    </Dialog>
  );
}
