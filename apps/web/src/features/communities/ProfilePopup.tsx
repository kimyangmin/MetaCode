import type { UserDetail } from '@metacode/shared';
import { useQuery } from '@tanstack/react-query';
import { type CSSProperties, Suspense, lazy } from 'react';
import { apiFetch } from '../../api/client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { type ProfileTarget, useProfileStore } from '../../stores/profile';
import { useIsOnline, displayName, memberColor } from '@metacode/client';
import { Avatar, largeAvatarUrl } from '../../ui/Avatar';
import { Lightbox } from '../../ui/Lightbox';
import { useExitTransition } from '../../ui/useExitTransition';
import { useIsPhone } from '../../ui/useMediaQuery';
import { gestureAxis } from '../../ui/swipe';
import { FriendButton } from '../friends/FriendButton';
import { useCommunities, useMeRequired, useMembers, useOpenDm } from './hooks';
import { sheetDragOffset, shouldCloseSheet } from './profileSheet';

const ROLE_LABEL = { OWNER: '소유자', ADMIN: '관리자', MEMBER: '' } as const;

// 캐릭터는 내장 에셋(약 150KB)을 쓰므로 팝업을 처음 열 때 따로 불러온다.
const ProfileCharacter = lazy(() => import('./ProfileCharacter'));
const MARGIN = 8;

/** 사라지는 애니메이션 길이 (styles.css의 popup-out과 같게) */
const CLOSE_MS = 120;
/** 시트가 내려가는 애니메이션 길이 (styles.css의 sheet-down과 같게) */
const SHEET_CLOSE_MS = 220;

/**
 * 사용자 정보 팝업: 아바타, 닉네임, 사용자 ID, 온라인 여부, 자기소개, (커뮤니티 화면이면) 역할, 메시지 보내기.
 * 누른 자리 옆에 띄우고, 바깥을 누르거나 Esc를 누르면 닫는다.
 * 멤버 목록에서 열면 목록 왼쪽에, 휴대폰이면 아래에서 올라오는 시트로 띄우고 끌어내려 닫는다.
 * 사진을 누르면 크게 보고, 크게 보는 동안에는 팝업이 바깥 누르기·Esc로 닫히지 않는다 (크게 보기가 먼저 닫힘).
 */
export function ProfilePopup() {
  const target = useProfileStore((s) => s.target);
  const close = useProfileStore((s) => s.close);
  const phone = useIsPhone();
  // 닫을 때는 잠깐 남겨 사라지는 애니메이션을 보여 준다.
  // 휴대폰에서는 시트가 내려가는 시간만큼 (다른 팝업은 그 전에 이미 사라져 보이지 않음)
  const { shown, closing } = useExitTransition(target, phone ? SHEET_CLOSE_MS : CLOSE_MS);
  // 휴대폰에서 멤버 목록으로 열면 화면 아래에 붙는 시트 (자리는 CSS가 정함)
  const sheet = phone && !!shown?.beside;
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' });
  /** 멤버 목록 왼쪽에 띄웠는지 (열리는 애니메이션의 기준점) */
  const [besideList, setBesideList] = useState(false);
  // 사진을 크게 보는 팝업. 팝업을 닫거나 다른 사람을 열면(target이 바뀜) 저절로 꺼진다.
  const [zoomFor, setZoomFor] = useState<ProfileTarget | null>(null);
  const zoomed = zoomFor !== null && zoomFor === target;

  // 창 밖으로 나가지 않게 자리를 잡는다.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!target || !el || (phone && target.beside)) return;
    // 열리는 애니메이션(scale) 중이라 getBoundingClientRect는 작게 나온다. 레이아웃 크기를 쓴다.
    const { offsetWidth: width, offsetHeight: height } = el;
    const maxTop = window.innerHeight - height - MARGIN;
    // 멤버 목록: 목록 왼쪽 바깥에 누른 줄과 같은 높이로 (Discord처럼). 자리가 없으면 누른 자리 옆.
    if (target.beside && target.anchor) {
      const left = target.beside.getBoundingClientRect().left - width - MARGIN;
      if (left >= MARGIN) {
        const top = Math.min(target.anchor.getBoundingClientRect().top, maxTop);
        setPosition({ left, top: Math.max(MARGIN, top) });
        setBesideList(true);
        return;
      }
    }
    const left = Math.min(target.x + MARGIN, window.innerWidth - width - MARGIN);
    const top = Math.min(target.y, maxTop);
    setPosition({ left: Math.max(MARGIN, left), top: Math.max(MARGIN, top) });
    setBesideList(false);
  }, [target, phone]);

  // 시트 끌어내리기: 미는 동안 손가락을 따라 내려가고, 충분히(또는 빠르게) 내리면 닫는다.
  // 닫을 때는 끌어 둔 자리(인라인 transform)에서 sheet-down 애니메이션이 이어서 내려간다.
  useEffect(() => {
    const el = ref.current;
    if (!sheet || !el) return;
    let drag: { x: number; y: number; at: number; axis: 'x' | 'y' | null } | null = null;
    let offset = 0;
    const reset = () => {
      drag = null;
      offset = 0;
      el.style.removeProperty('transform');
      delete el.dataset.dragging;
    };
    const onStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      // 내용을 스크롤해 내린 상태면 위로 올리는 스크롤로 둔다.
      if (!touch || e.touches.length > 1 || el.scrollTop > 0) return reset();
      drag = { x: touch.clientX, y: touch.clientY, at: e.timeStamp, axis: null };
    };
    const onMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!drag || !touch) return;
      const dy = touch.clientY - drag.y;
      drag.axis ??= gestureAxis(touch.clientX - drag.x, dy);
      if (drag.axis === 'x') return reset();
      if (drag.axis !== 'y') return;
      if (e.cancelable) e.preventDefault();
      offset = sheetDragOffset(dy);
      el.dataset.dragging = 'true';
      el.style.transform = `translateY(${offset}px)`;
    };
    const onEnd = (e: TouchEvent) => {
      if (drag?.axis === 'y' && shouldCloseSheet(offset, e.timeStamp - drag.at)) {
        drag = null;
        delete el.dataset.dragging;
        close();
        return;
      }
      reset();
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    // 끄는 동안 페이지가 스크롤되거나 당겨 새로 고침되지 않게 막아야 해서 passive가 아니다.
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', reset);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', reset);
      reset();
    };
  }, [sheet, shown, close]);

  useEffect(() => {
    if (!target || zoomed) return;
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
  }, [target, close, zoomed]);

  if (!shown) return null;
  return (
    <>
      {sheet && (
        <div className="profile-sheet__backdrop" data-closing={closing || undefined} aria-hidden />
      )}
      <div
        ref={ref}
        className="profile-popup"
        role="dialog"
        aria-label={`${displayName(shown.user)} 정보`}
        data-closing={closing || undefined}
        data-placement={sheet ? 'sheet' : besideList ? 'left' : undefined}
        style={sheet ? undefined : position}
      >
        {sheet && <div className="profile-popup__grabber" aria-hidden />}
        <ProfileBody
          key={`${shown.user.id}-${shown.communityId}`}
          target={shown}
          onZoom={() => setZoomFor(shown)}
        />
        {zoomed && (
          <Lightbox
            src={largeAvatarUrl(shown.user)}
            alt={`${displayName(shown.user)}의 프로필 사진`}
            variant="avatar"
            onClose={() => setZoomFor(null)}
          />
        )}
      </div>
    </>
  );
}

function ProfileBody({ target, onZoom }: { target: ProfileTarget; onZoom(): void }) {
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
        <button
          type="button"
          className="profile-popup__avatar"
          onClick={onZoom}
          aria-label="프로필 사진 크게 보기"
          title="크게 보기"
        >
          <Avatar user={user} size={56} animate />
        </button>
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
