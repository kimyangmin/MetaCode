import type { CommunitySummary, InviteInfo } from '@metacode/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { ApiError, apiFetch } from './api/client';
import { queryKeys } from './api/queries';
import { ChatView } from './features/chat/ChatView';
import { ChannelSettingsButton } from './features/communities/ChannelSettings';
import { CommunitySidebar } from './features/communities/CommunitySidebar';
import { MemberList } from './features/communities/MemberList';
import {
  upsertCommunity,
  useCommunities,
  useDms,
  useMeRequired,
  useMembers,
} from './features/communities/hooks';
import { FriendsPanel } from './features/friends/FriendsPanel';
import { DmSidebar } from './features/dms/DmSidebar';
import { PlazaPanel } from './features/metaverse/PlazaPanel';
import { CallButton } from './features/voice/CallButton';
import { MembersResizer } from './layout/MembersResizer';
import { SplitView } from './layout/SplitView';
import { useUiStore } from './stores/ui';
import { dmTitle } from '@metacode/client';
import { NARROW_QUERY, useMediaQuery } from './ui/useMediaQuery';
import { Flame, Users } from 'lucide-react';
import { Fountain } from './ui/icons';
import type { VoiceLabel } from './features/metaverse/plazaVoice';

/** 첫 화면: 첫 커뮤니티로, 없으면 DM으로 */
export function HomeRedirect() {
  const communities = useCommunities();
  if (!communities.data) return <Loading />;
  const first = communities.data[0];
  return <Navigate to={first ? `/c/${first.id}` : '/dm'} replace />;
}

export function CommunityPage() {
  const { communityId, channelId } = useParams();
  const me = useMeRequired();
  const communities = useCommunities();
  const community = communities.data?.find((c) => c.id === communityId);
  const members = useMembers(communityId ?? '');
  const membersHidden = useUiStore((s) => s.membersHidden);
  const membersDrawerOpen = useUiStore((s) => s.membersDrawerOpen);
  // 좁은 화면에서는 멤버 목록을 자리에 두지 않고 서랍으로 겹쳐 띄운다 (처음엔 닫힘).
  const narrow = useMediaQuery(NARROW_QUERY);
  const membersOpen = narrow ? membersDrawerOpen : !membersHidden;
  const membersWidth = useUiStore((s) => s.membersWidth);
  const membersSlot = useRef<HTMLDivElement>(null);

  if (!communities.data) return <Loading />;
  // 나갔거나 삭제된 커뮤니티
  if (!community) return <Navigate to="/" replace />;
  const channel =
    community.channels.find((c) => c.id === channelId) ??
    community.channels.find((c) => c.type === 'TEXT');
  if (!channel) return <Navigate to="/" replace />;
  if (channel.id !== channelId) return <Navigate to={`/c/${community.id}/${channel.id}`} replace />;

  return (
    <>
      <CommunitySidebar community={community} activeChannelId={channel.id} />
      <SplitView
        popoutPaths={{
          chat: `/popout/chat/${channel.id}`,
          plaza: `/popout/plaza/community:${community.id}`,
        }}
        phoneTools={<ChannelSettingsButton community={community} channel={channel} />}
        chat={({ actions, handle }) => (
          <ChatView
            key={channel.id}
            channelId={channel.id}
            title={channel.name ?? ''}
            prefix="#"
            me={me}
            lastReadMessageId={channel.lastReadMessageId}
            people={members.data?.map((m) => m.user) ?? []}
            communityId={community.id}
            handle={handle}
            actions={
              actions && (
                <>
                  <MembersToggle />
                  {actions}
                </>
              )
            }
          />
        )}
        plaza={({ actions, handle }) => (
          <PlazaPanel
            plazaId={`community:${community.id}`}
            title={`${community.name} 광장`}
            icon={<Fountain />}
            me={me}
            channelLabels={textChannelLabels(community)}
            voiceLabels={voiceChannelLabels(community)}
            handle={handle}
            actions={
              actions && (
                <>
                  <MembersToggle />
                  {actions}
                </>
              )
            }
          />
        )}
      />
      {/* 숨겨도 내리지 않고 폭을 줄여 밀어 넣는다 (여닫는 애니메이션) */}
      <div
        ref={membersSlot}
        className="members-slot"
        data-open={membersOpen}
        inert={!membersOpen}
        style={{ '--members-w': `${membersWidth}px` } as CSSProperties}
      >
        <MembersResizer slotRef={membersSlot} />
        <MemberList communityId={community.id} />
      </div>
    </>
  );
}

export function DmPage() {
  const { channelId } = useParams();
  const me = useMeRequired();
  const dms = useDms();
  const dm = dms.data?.find((d) => d.id === channelId);

  if (channelId && dms.data && !dm) return <Navigate to="/dm" replace />;

  return (
    <>
      <DmSidebar activeId={channelId} />
      {dm ? (
        <SplitView
          popoutPaths={{ chat: `/popout/chat/${dm.id}`, plaza: `/popout/plaza/dm:${dm.id}` }}
          chat={({ actions, handle }) => (
            <ChatView
              key={dm.id}
              channelId={dm.id}
              title={dmTitle(dm, me.id)}
              prefix="@"
              me={me}
              lastReadMessageId={dm.lastReadMessageId}
              people={dm.participants}
              handle={handle}
              actions={
                <>
                  <CallButton channelId={dm.id} />
                  {actions}
                </>
              }
            />
          )}
          plaza={({ actions, handle }) => (
            <PlazaPanel
              plazaId={`dm:${dm.id}`}
              title="모닥불 캠프"
              icon={<Flame />}
              me={me}
              channelLabels={new Map([[dm.id, null]])}
              voiceLabels={new Map([[dm.id, { kind: 'call' as const, name: '통화 중' }]])}
              handle={handle}
              actions={actions}
            />
          )}
        />
      ) : (
        // 대화를 고르지 않았으면 친구 화면 (온라인 친구, 받은 요청, 친구 추가)
        <FriendsPanel />
      )}
    </>
  );
}

export function InvitePage() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const invite = useQuery({
    queryKey: ['invite', code],
    queryFn: () => apiFetch<InviteInfo>(`/invites/${encodeURIComponent(code)}`),
    retry: false,
  });

  useEffect(() => clearPendingInvite(), []);

  const accept = async () => {
    try {
      const community = await apiFetch<CommunitySummary>(
        `/invites/${encodeURIComponent(code)}/accept`,
        { method: 'POST' },
      );
      queryClient.setQueryData<CommunitySummary[]>(queryKeys.communities, (list) =>
        upsertCommunity(list, community),
      );
      navigate(`/c/${community.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '참여하지 못했습니다.');
    }
  };

  const failure =
    invite.error instanceof ApiError
      ? invite.error.status === 410
        ? '초대 링크가 만료되었습니다.'
        : '초대 링크가 올바르지 않습니다.'
      : invite.isError
        ? '초대 정보를 불러오지 못했습니다.'
        : null;

  return (
    <section className="invite">
      {invite.isPending && <p>초대 정보를 불러오는 중…</p>}
      {failure && <p className="form__error">{failure}</p>}
      {invite.data && (
        <>
          {invite.data.communityIconUrl && (
            <img className="invite__icon" src={invite.data.communityIconUrl} alt="" />
          )}
          <p className="invite__label">커뮤니티 초대</p>
          <h1>{invite.data.communityName}</h1>
          <p className="invite__meta">멤버 {invite.data.memberCount}명</p>
          {invite.data.joined ? (
            <button
              className="button button--primary"
              onClick={() => navigate(`/c/${invite.data.communityId}`, { replace: true })}
            >
              이미 참여 중 · 열기
            </button>
          ) : (
            <button className="button button--primary" onClick={accept}>
              참여하기
            </button>
          )}
          {error && <p className="form__error">{error}</p>}
        </>
      )}
    </section>
  );
}

/** 오른쪽 멤버 목록 보이기/숨기기 (넓은 화면은 기억하고, 좁은 화면은 서랍으로 연다) */
function MembersToggle() {
  const narrow = useMediaQuery(NARROW_QUERY);
  const membersHidden = useUiStore((s) => s.membersHidden);
  const drawerOpen = useUiStore((s) => s.membersDrawerOpen);
  const hidden = narrow ? !drawerOpen : membersHidden;
  const toggle = () => {
    const ui = useUiStore.getState();
    if (narrow) ui.setMembersDrawer(!drawerOpen);
    else ui.toggleMembers();
  };
  return (
    <button
      type="button"
      className="icon-button members-toggle"
      aria-pressed={!hidden}
      onClick={toggle}
      title={hidden ? '멤버 목록 보이기' : '멤버 목록 숨기기'}
      aria-label={hidden ? '멤버 목록 보이기' : '멤버 목록 숨기기'}
    >
      <Users aria-hidden />
    </button>
  );
}

/** 분수 광장에는 커뮤니티의 모든 텍스트 채널 메시지가 채널 이름과 함께 뜬다 */
export function textChannelLabels(community: CommunitySummary): Map<string, string> {
  return new Map(
    community.channels.filter((c) => c.type === 'TEXT').map((c) => [c.id, `#${c.name}`]),
  );
}

/** 광장 캐릭터 위에 참여 중인 음성 채널을 보여 준다 (스피커 아이콘 + 채널 이름) */
export function voiceChannelLabels(community: CommunitySummary): Map<string, VoiceLabel> {
  return new Map(
    community.channels
      .filter((c) => c.type === 'VOICE')
      .map((c) => [c.id, { kind: 'channel' as const, name: c.name ?? '' }]),
  );
}

function Loading() {
  return <section className="chat chat--empty">불러오는 중…</section>;
}

// ── 로그인 전에 연 초대 링크를 로그인 후까지 기억한다 ──

const PENDING_INVITE_KEY = 'metacode:pending-invite';

/** 로그인 화면을 띄우기 전에 부른다. 주소가 초대 링크면 코드를 기억해 둔다. */
export function rememberPendingInvite(): void {
  const match = (window.location.pathname + window.location.hash).match(/invite\/([A-Za-z0-9]+)/);
  if (!match) return;
  try {
    sessionStorage.setItem(PENDING_INVITE_KEY, match[1]!);
  } catch {
    // 저장소를 쓸 수 없는 환경이면 초대 링크를 다시 열어야 한다.
  }
}

export function takePendingInvite(): string | null {
  try {
    return sessionStorage.getItem(PENDING_INVITE_KEY);
  } catch {
    return null;
  }
}

function clearPendingInvite(): void {
  try {
    sessionStorage.removeItem(PENDING_INVITE_KEY);
  } catch {
    // 무시
  }
}
