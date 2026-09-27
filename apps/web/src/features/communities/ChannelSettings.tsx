import type { ChannelSummary, CommunitySummary, RoleDto } from '@metacode/shared';
import { useQueryClient } from '@tanstack/react-query';
import { type CSSProperties, type FormEvent, useState } from 'react';
import { ApiError, apiFetch } from '../../api/client';
import { jsonBody, queryKeys } from '../../api/queries';
import { Dialog } from '../../ui/Dialog';

/**
 * 비공개 채널 설정 칸: 켜면 소유자, 관리자, 고른 역할을 가진 멤버만 채널을 보고 읽고 쓴다
 * (음성 채널이면 통화도). 채널 만들기와 채널 설정에서 같이 쓴다.
 */
export function ChannelAccessFields({
  roles,
  isPrivate,
  roleIds,
  onChange,
}: {
  roles: RoleDto[];
  isPrivate: boolean;
  roleIds: string[];
  onChange(next: { isPrivate: boolean; roleIds: string[] }): void;
}) {
  const toggleRole = (id: string) =>
    onChange({
      isPrivate,
      roleIds: roleIds.includes(id) ? roleIds.filter((r) => r !== id) : [...roleIds, id],
    });

  return (
    <fieldset className="channel-access">
      <label className="channel-access__private">
        <input
          type="checkbox"
          checked={isPrivate}
          onChange={(e) => onChange({ isPrivate: e.target.checked, roleIds })}
        />
        🔒 비공개 채널
      </label>
      {isPrivate && (
        <>
          <p className="form__hint">
            소유자와 관리자, 아래에서 고른 역할을 가진 멤버만 이 채널을 봅니다. 광장 말풍선도 볼 수
            있는 사람에게만 뜹니다.
          </p>
          {roles.length === 0 ? (
            <p className="form__hint">
              아직 역할이 없습니다. 커뮤니티 설정에서 역할을 만들 수 있습니다.
            </p>
          ) : (
            <div className="member-roles__chips">
              {roles.map((role) => (
                <label
                  key={role.id}
                  className="role-chip"
                  style={{ '--role-color': role.color ?? 'var(--muted)' } as CSSProperties}
                >
                  <input
                    type="checkbox"
                    checked={roleIds.includes(role.id)}
                    onChange={() => toggleRole(role.id)}
                  />
                  {role.name}
                </label>
              ))}
            </div>
          )}
        </>
      )}
    </fieldset>
  );
}

/** 채널 설정 (소유자, 관리자): 이름, 비공개 여부, 볼 수 있는 역할 */
export function ChannelSettings({
  community,
  channel,
  onClose,
}: {
  community: CommunitySummary;
  channel: ChannelSummary;
  onClose(): void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(channel.name ?? '');
  const [access, setAccess] = useState({ isPrivate: channel.private, roleIds: channel.roleIds });
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch(`/channels/${channel.id}`, {
        method: 'PATCH',
        ...jsonBody({ name, private: access.isPrivate, roleIds: access.roleIds }),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.communities });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '채널 설정을 바꾸지 못했습니다.');
    }
  };

  return (
    <Dialog title="채널 설정" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>
          채널 이름
          <div className="input-prefix">
            <span>{channel.type === 'VOICE' ? '🔊' : '#'}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} required />
          </div>
        </label>
        <ChannelAccessFields
          roles={community.roles}
          isPrivate={access.isPrivate}
          roleIds={access.roleIds}
          onChange={setAccess}
        />
        {error && <p className="form__error">{error}</p>}
        <button className="button button--primary" disabled={!name.trim()}>
          저장
        </button>
      </form>
    </Dialog>
  );
}
