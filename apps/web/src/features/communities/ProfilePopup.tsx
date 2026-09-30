import type { UserDetail } from '@metacode/shared';
import { useQuery } from '@tanstack/react-query';
import { type CSSProperties, Suspense, lazy } from 'react';
import { apiFetch } from '../../api/client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { type ProfileTarget, useProfileStore } from '../../stores/profile';
import { useIsOnline, displayName, memberColor } from '@metacode/client';
import { Avatar } from '../../ui/Avatar';
import { useExitTransition } from '../../ui/useExitTransition';
import { FriendButton } from '../friends/FriendButton';
import { useCommunities, useMeRequired, useMembers, useOpenDm } from './hooks';

const ROLE_LABEL = { OWNER: '소유자', ADMIN: '관리자', MEMBER: '' } as const;

// 캐릭터는 내장 에셋(약 150KB)을 쓰므로 팝업을 처음 열 때 따로 불러온다.
const ProfileCharacter = lazy(() => import('./ProfileCharacter'));
const MARGIN = 8;
/** 사라지는 애니메이션 길이 (styles.css의 popup-out과 같게) */
const CLOSE_MS = 120;

/**
 * 사용자 정보 팝업: 아바타, 닉네임, 사용자 ID, 온라인 여부, 자기소개, (커뮤니티 화면이면) 역할, 메시지 보내기.
 * 누른 자리 옆에 띄우고, 바깥을 누르거나 Esc를 누르면 닫는다.
 */
export function ProfilePopup() {
  const target = useProfileStore((s) => s.target);
  const close = useProfileStore((s) => s.close);
  // 닫을 때는 잠깐 남겨 사라지는 애니메이션을 보여 준다.
  const { shown, closing } = useExitTransition(target, CLOSE_MS);
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
      const clicked = e.target as Node;
      // 연 요소를 다시 누르는 것은 그 요소의 onClick(openProfile)이 닫는다.
      if (ref.current?.contains(clicked) || target.anchor?.contains(clicked)) return;
      close();
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

  if (!shown) return null;
  return (
    <div
      ref={ref}
      className="profile-popup"
      role="dialog"
      aria-label={`${displayName(shown.user)} 정보`}
      data-closing={closing || undefined}
      style={position}
    >
      <ProfileBody key={`${shown.user.id}-${shown.communityId}`} target={shown} />
    </div>
  );
}

function ProfileBody({ target }: { target: ProfileTarget }) {
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
        <Avatar user={user} size={56} animate />
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
      {/* 광장에서 쓰는 캐릭터가 걷는 모습. 불러오는 동안에도 자리를 잡아 팝업 크기가 바뀌지 않게 한다 */}
      <div className="profile-popup__character" aria-label="캐릭터">
        <Suspense fallback={null}>
          <ProfileCharacter user={user} />
        </Suspense>
      </div>
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
