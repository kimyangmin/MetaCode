import {
  type CommunityMember,
  CommunityRole,
  type CommunitySummary,
  type RoleDto,
} from '@metacode/shared';
import { useQueryClient } from '@tanstack/react-query';
import { type CSSProperties, type FormEvent, useRef, useState } from 'react';
import { ApiError, apiFetch } from '../../api/client';
import { jsonBody, queryKeys } from '../../api/queries';
import { Avatar } from '../../ui/Avatar';
import { Dialog } from '../../ui/Dialog';
import { displayName } from '../../ui/format';
import { useDragSort } from '../../ui/useDragSort';
import { useMeRequired, useMembers } from './hooks';

const DEFAULT_COLOR = '#3f8fdb';

type Tab = 'roles' | 'members';

/**
 * 커뮤니티 설정 (소유자, 관리자): 역할 만들기/바꾸기/지우기, 멤버에게 역할 주기, 관리자 정하기(소유자만).
 * 비공개 채널을 누가 볼지는 채널 설정에서 역할로 정한다.
 */
export function CommunitySettings({
  community,
  onClose,
}: {
  community: CommunitySummary;
  onClose(): void;
}) {
  const [tab, setTab] = useState<Tab>('roles');
  return (
    <Dialog title="커뮤니티 설정" onClose={onClose}>
      <div className="settings">
        <div className="settings__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'roles'}
            onClick={() => setTab('roles')}
          >
            역할
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'members'}
            onClick={() => setTab('members')}
          >
            멤버
          </button>
        </div>
        {tab === 'roles' ? (
          <RolesTab community={community} />
        ) : (
          <MembersTab community={community} />
        )}
      </div>
    </Dialog>
  );
}

/** 요청 후 커뮤니티 정보(역할, 채널)와 멤버를 새로 받는다. 서버도 community:updated로 알린다 */
function useRefresh(communityId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.communities });
    void queryClient.invalidateQueries({ queryKey: queryKeys.members(communityId) });
  };
}

function useRequest() {
  const [error, setError] = useState<string | null>(null);
  const run = async (request: () => Promise<unknown>, fallback: string) => {
    setError(null);
    try {
      await request();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fallback);
      return false;
    }
  };
  return { error, run };
}

function RolesTab({ community }: { community: CommunitySummary }) {
  const refresh = useRefresh(community.id);
  const { error, run } = useRequest();
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_COLOR);

  const sort = useDragSort(
    community.roles.map((r) => r.id),
    (ids) =>
      void run(
        () =>
          apiFetch(`/communities/${community.id}/roles/order`, {
            method: 'PUT',
            ...jsonBody({ ids }),
          }),
        '순서를 바꾸지 못했습니다.',
      ).then(refresh),
  );

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await run(
      () =>
        apiFetch<RoleDto>(`/communities/${community.id}/roles`, {
          method: 'POST',
          ...jsonBody({ name, color }),
        }),
      '역할을 만들지 못했습니다.',
    );
    if (ok) {
      setName('');
      refresh();
    }
  };

  return (
    <div className="form">
      <p className="form__hint">
        ⠿를 끌어 순서를 바꿀 수 있습니다. 역할을 만들어 멤버에게 주면, 비공개 채널을 그 역할을 가진
        멤버에게만 보여 줄 수 있습니다. 이름 색은 가진 역할 중 가장 위 역할의 색을 따릅니다.
      </p>
      {community.roles.length === 0 && <p className="settings__empty">아직 역할이 없습니다.</p>}
      <ul className="role-list">
        {community.roles.map((role) => (
          <RoleRow
            key={role.id}
            sortProps={sort.itemProps(role.id)}
            communityId={community.id}
            role={role}
            onError={run}
            onDone={refresh}
          />
        ))}
      </ul>
      <form className="role-form" onSubmit={create}>
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          aria-label="새 역할 색"
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="새 역할 이름"
          maxLength={30}
          aria-label="새 역할 이름"
        />
        <button className="button button--primary" disabled={!name.trim()}>
          만들기
        </button>
      </form>
      {error && <p className="form__error">{error}</p>}
    </div>
  );
}

function RoleRow({
  communityId,
  role,
  onError,
  onDone,
  sortProps,
}: {
  communityId: string;
  role: RoleDto;
  sortProps: ReturnType<ReturnType<typeof useDragSort>['itemProps']>;
  onError: ReturnType<typeof useRequest>['run'];
  onDone(): void;
}) {
  const [name, setName] = useState(role.name);
  const colorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const url = `/communities/${communityId}/roles/${role.id}`;

  const update = async (patch: { name?: string; color?: string }) => {
    const ok = await onError(
      () => apiFetch(url, { method: 'PATCH', ...jsonBody(patch) }),
      '역할을 바꾸지 못했습니다.',
    );
    if (ok) onDone();
    else setName(role.name);
  };

  const remove = async () => {
    if (
      !window.confirm(
        `"${role.name}" 역할을 지울까요? 이 역할로 보던 비공개 채널은 볼 수 없게 됩니다.`,
      )
    ) {
      return;
    }
    if (await onError(() => apiFetch(url, { method: 'DELETE' }), '역할을 지우지 못했습니다.')) {
      onDone();
    }
  };

  return (
    <li className="role-list__item" {...sortProps}>
      <span className="drag-handle" aria-hidden title="끌어서 순서 바꾸기">
        ⠿
      </span>
      <input
        type="color"
        defaultValue={role.color ?? DEFAULT_COLOR}
        // 색을 고르는 동안 요청이 쏟아지지 않게, 움직임이 멈추면 한 번만 보낸다.
        onChange={(e) => {
          const color = e.target.value;
          clearTimeout(colorTimer.current);
          colorTimer.current = setTimeout(() => void update({ color }), 400);
        }}
        aria-label={`${role.name} 색`}
      />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== role.name && void update({ name })}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        maxLength={30}
        aria-label="역할 이름"
      />
      <button
        type="button"
        className="icon-button role-list__remove"
        onClick={() => void remove()}
        aria-label={`${role.name} 지우기`}
        title="지우기"
      >
        ×
      </button>
    </li>
  );
}

function MembersTab({ community }: { community: CommunitySummary }) {
  const members = useMembers(community.id);
  const refresh = useRefresh(community.id);
  const { error, run } = useRequest();
  const isOwner = community.myRole === CommunityRole.Owner;

  const toggleRole = async (member: CommunityMember, roleId: string) => {
    const roleIds = member.roleIds.includes(roleId)
      ? member.roleIds.filter((id) => id !== roleId)
      : [...member.roleIds, roleId];
    const ok = await run(
      () =>
        apiFetch(`/communities/${community.id}/members/${member.user.id}/roles`, {
          method: 'PUT',
          ...jsonBody({ roleIds }),
        }),
      '역할을 주지 못했습니다.',
    );
    if (ok) refresh();
  };

  const me = useMeRequired();
  /** 내보낼 수 있는지: 나와 소유자는 안 되고, 관리자는 소유자만 내보낸다 */
  const canKick = (member: CommunityMember) =>
    member.user.id !== me.id &&
    member.role !== CommunityRole.Owner &&
    (member.role !== CommunityRole.Admin || isOwner);

  const kick = async (member: CommunityMember) => {
    if (
      !window.confirm(
        `${displayName(member.user)}님을 커뮤니티에서 내보낼까요? 초대 링크로 다시 들어올 수 있습니다.`,
      )
    ) {
      return;
    }
    const ok = await run(
      () =>
        apiFetch(`/communities/${community.id}/members/${member.user.id}`, { method: 'DELETE' }),
      '내보내지 못했습니다.',
    );
    if (ok) refresh();
  };

  const toggleAdmin = async (member: CommunityMember) => {
    const ok = await run(
      () =>
        apiFetch(`/communities/${community.id}/members/${member.user.id}/admin`, {
          method: 'PUT',
          ...jsonBody({ admin: member.role !== CommunityRole.Admin }),
        }),
      '관리자를 바꾸지 못했습니다.',
    );
    if (ok) refresh();
  };

  return (
    <div className="form">
      <p className="form__hint">
        관리자는 역할과 채널을 관리하고 모든 비공개 채널을 봅니다. 관리자는 소유자만 정할 수
        있습니다.
      </p>
      {!members.data && <p className="form__hint">불러오는 중…</p>}
      <ul className="member-roles">
        {members.data?.map((member) => (
          <li key={member.user.id} className="member-roles__item">
            <div className="member-roles__who">
              <Avatar user={member.user} size={24} />
              <span>{displayName(member.user)}</span>
              {member.role === CommunityRole.Owner && <span className="members__role">소유자</span>}
              {isOwner && member.role !== CommunityRole.Owner && (
                <label className="member-roles__admin">
                  <input
                    type="checkbox"
                    checked={member.role === CommunityRole.Admin}
                    onChange={() => void toggleAdmin(member)}
                  />
                  관리자
                </label>
              )}
              {!isOwner && member.role === CommunityRole.Admin && (
                <span className="members__role">관리자</span>
              )}
              {canKick(member) && (
                <button
                  type="button"
                  className="member-roles__kick"
                  onClick={() => void kick(member)}
                >
                  내보내기
                </button>
              )}
            </div>
            {community.roles.length > 0 && (
              <div className="member-roles__chips">
                {community.roles.map((role) => (
                  <label
                    key={role.id}
                    className="role-chip"
                    style={{ '--role-color': role.color ?? 'var(--muted)' } as CSSProperties}
                  >
                    <input
                      type="checkbox"
                      checked={member.roleIds.includes(role.id)}
                      onChange={() => void toggleRole(member, role.id)}
                    />
                    {role.name}
                  </label>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="form__error">{error}</p>}
    </div>
  );
}
