import type { UserDetail } from '@metacode/shared';
import { useQuery } from '@tanstack/react-query';
import type { CSSProperties } from 'react';
import { apiFetch } from '../../api/client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useProfileStore } from '../../stores/profile';
import { useIsOnline } from '../../stores/presence';
import { Avatar } from '../../ui/Avatar';
import { displayName } from '../../ui/format';
import { FriendButton } from '../friends/FriendButton';
import { useCommunities, useMeRequired, useMembers, useOpenDm } from './hooks';
import { memberColor } from './roles';

const ROLE_LABEL = { OWNER: '소유자', ADMIN: '관리자', MEMBER: '' } as const;
const MARGIN = 8;

/**
 * 사용자 정보 팝업: 아바타, 닉네임, 사용자 ID, 온라인 여부, 자기소개, (커뮤니티 화면이면) 역할, 메시지 보내기.
 * 누른 자리 옆에 띄우고, 바깥을 누르거나 Esc를 누르면 닫는다.
 */
export function ProfilePopup() {
  const target = useProfileStore((s) => s.target);
  const close = useProfileStore((s) => s.close);
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' });

  // 창 밖으로 나가지 않게 자리를 잡는다.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!target || !el) return;
    const { width, height } = el.getBoundingClientRect();
    const left = Math.min(target.x + MARGIN, window.innerWidth - width - MARGIN);
    const top = Math.min(target.y, window.innerHeight - height - MARGIN);
    setPosition({ left: Math.max(MARGIN, left), top: Math.max(MARGIN, top) });
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    window.addEventListener('keydown', onKey);
    // 연 클릭이 바로 닫지 않도록 다음 틱부터 듣는다.
    const timer = setTimeout(() => window.addEventListener('mousedown', onDown));
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [target, close]);

  if (!target) return null;
  return (
    <div
      ref={ref}
      className="profile-popup"
      role="dialog"
      aria-label={`${displayName(target.user)} 정보`}
      style={position}
    >
      <ProfileBody key={`${target.user.id}-${target.communityId}`} />
    </div>
  );
}

function ProfileBody() {
  const target = useProfileStore((s) => s.target)!;
  const close = useProfileStore((s) => s.close);
  const { user, communityId } = target;
  const me = useMeRequired();
  const online = useIsOnline(user.id);
  const openDm = useOpenDm();
  const members = useMembers(communityId ?? '');
  const community = useCommunities().data?.find((c) => c.id === communityId);
  const member = members.data?.find((m) => m.user.id === user.id);
  const roles = community?.roles.filter((r) => member?.roleIds.includes(r.id)) ?? [];
  const color = member && community ? memberColor(member.roleIds, community.roles) : null;
  // 자기소개는 메시지·멤버 목록에 들고 다니지 않고 팝업을 열 때 받는다.
  const detail = useQuery({
    queryKey: ['user-detail', user.id],
    queryFn: () => apiFetch<UserDetail>(`/users/${user.id}`),
    staleTime: 60_000,
  });
  const bio = user.id === me.id ? me.bio : detail.data?.bio;

  return (
    <>
      <div className="profile-popup__head">
        <Avatar user={user} size={56} />
        <div className="profile-popup__names">
          <strong style={{ color: color ?? undefined }}>{displayName(user)}</strong>
          <a
            href={`https://github.com/${encodeURIComponent(user.username)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            @{user.username}
          </a>
          <span className="profile-popup__status" data-online={online}>
            {online ? '온라인' : '오프라인'}
          </span>
        </div>
      </div>
      {bio && <p className="profile-popup__bio">{bio}</p>}
      {member && (ROLE_LABEL[member.role] || roles.length > 0) && (
        <div className="profile-popup__roles" aria-label="역할">
          {ROLE_LABEL[member.role] && <span className="role-tag">{ROLE_LABEL[member.role]}</span>}
          {roles.map((role) => (
            <span
              key={role.id}
              className="role-tag"
              style={{ '--role-color': role.color ?? 'var(--muted)' } as CSSProperties}
            >
              {role.name}
            </span>
          ))}
        </div>
      )}
      {user.id !== me.id && (
        <div className="profile-popup__actions">
          <button
            type="button"
            className="button button--primary"
            onClick={() => {
              close();
              void openDm([user.id]);
            }}
          >
            메시지 보내기
          </button>
          <FriendButton user={user} />
        </div>
      )}
    </>
  );
}
