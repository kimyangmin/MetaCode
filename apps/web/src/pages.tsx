import type { CommunitySummary, InviteInfo } from '@metacode/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { ApiError, apiFetch } from './api/client';
import { queryKeys } from './api/queries';
import { ChatView } from './features/chat/ChatView';
import { CommunitySidebar } from './features/communities/CommunitySidebar';
import { MemberList } from './features/communities/MemberList';
import {
  upsertCommunity,
  useCommunities,
  useDms,
  useMeRequired,
  useMembers,
} from './features/communities/hooks';
import { DmSidebar } from './features/dms/DmSidebar';
import { dmTitle } from './ui/format';

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
      <ChatView
        key={channel.id}
        channelId={channel.id}
        title={channel.name ?? ''}
        prefix="#"
        me={me}
        lastReadMessageId={channel.lastReadMessageId}
        people={members.data?.map((m) => m.user) ?? []}
      />
      <MemberList communityId={community.id} />
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
        <ChatView
          key={dm.id}
          channelId={dm.id}
          title={dmTitle(dm, me.id)}
          prefix="@"
          me={me}
          lastReadMessageId={dm.lastReadMessageId}
          people={dm.participants}
        />
      ) : (
        <section className="chat chat--empty">
          <p>왼쪽에서 대화를 고르거나, 커뮤니티 멤버를 눌러 대화를 시작해 보세요.</p>
        </section>
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
