import { type PlazaId, parsePlazaId } from '@metacode/shared';
import { type ReactNode, useEffect } from 'react';
import { useParams } from 'react-router';
import { ChatView } from '../features/chat/ChatView';
import { ProfilePopup } from '../features/communities/ProfilePopup';
import { useCommunities, useDms, useMeRequired, useMembers } from '../features/communities/hooks';
import { PlazaPanel } from '../features/metaverse/PlazaPanel';
import { textChannelLabels, voiceChannelLabels } from '../pages';
import { dmTitle } from '@metacode/client';
import { Flame } from 'lucide-react';
import { Fountain } from '../ui/icons';

/**
 * 분리한 창: 채팅 또는 광장 하나만 창 가득 보여 준다.
 * 메인 창과 별개로 로그인 상태(쿠키/데스크톱 토큰)를 그대로 쓰고, 실시간 연결을 따로 연다.
 */
function PopoutShell({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => {
    document.title = `${title} - MetaCode`;
  }, [title]);
  return (
    <div className="popout">
      {children}
      <ProfilePopup />
    </div>
  );
}

/** 메인 창으로 돌려놓기: 이 창을 닫으면 메인 창이 알아채고 다시 보여 준다 */
const backButton = (
  <button
    type="button"
    className="view-toggles__button view-toggles__button--solo"
    onClick={() => window.close()}
    title="이 창을 닫고 메인 창으로 돌려놓기"
  >
    메인 창으로
  </button>
);

export function PopoutChat() {
  const { channelId = '' } = useParams();
  const me = useMeRequired();
  const communities = useCommunities();
  const dms = useDms();
  const community = communities.data?.find((c) => c.channels.some((ch) => ch.id === channelId));
  const channel = community?.channels.find((ch) => ch.id === channelId);
  const dm = dms.data?.find((d) => d.id === channelId);
  const members = useMembers(community?.id ?? '');

  if (!communities.data || !dms.data) {
    return <PopoutShell title="채팅">{<p className="popout__status">불러오는 중…</p>}</PopoutShell>;
  }
  if (community && channel) {
    return (
      <PopoutShell title={`#${channel.name}`}>
        <ChatView
          channelId={channel.id}
          title={channel.name ?? ''}
          prefix="#"
          me={me}
          lastReadMessageId={channel.lastReadMessageId}
          people={members.data?.map((m) => m.user) ?? []}
          communityId={community.id}
          actions={backButton}
        />
      </PopoutShell>
    );
  }
  if (dm) {
    return (
      <PopoutShell title={`@${dmTitle(dm, me.id)}`}>
        <ChatView
          channelId={dm.id}
          title={dmTitle(dm, me.id)}
          prefix="@"
          me={me}
          lastReadMessageId={dm.lastReadMessageId}
          people={dm.participants}
          actions={backButton}
        />
      </PopoutShell>
    );
  }
  return (
    <PopoutShell title="채팅">
      <p className="popout__status">이 채널을 볼 수 없습니다.</p>
    </PopoutShell>
  );
}

export function PopoutPlaza() {
  const { plazaId = '' } = useParams();
  const me = useMeRequired();
  const communities = useCommunities();
  const dms = useDms();
  const valid = /^(community|dm):[0-9a-f-]{36}$/.test(plazaId);
  const { kind, id } = valid ? parsePlazaId(plazaId as PlazaId) : { kind: null, id: '' };
  const community = kind === 'community' ? communities.data?.find((c) => c.id === id) : undefined;
  const dm = kind === 'dm' ? dms.data?.find((d) => d.id === id) : undefined;

  if (!communities.data || !dms.data) {
    return <PopoutShell title="광장">{<p className="popout__status">불러오는 중…</p>}</PopoutShell>;
  }
  if (community) {
    return (
      <PopoutShell title={`${community.name} 광장`}>
        <PlazaPanel
          plazaId={`community:${community.id}`}
          title={`${community.name} 광장`}
          icon={<Fountain />}
          me={me}
          channelLabels={textChannelLabels(community)}
          voiceLabels={voiceChannelLabels(community)}
          actions={backButton}
        />
      </PopoutShell>
    );
  }
  if (dm) {
    return (
      <PopoutShell title="모닥불 캠프">
        <PlazaPanel
          plazaId={`dm:${dm.id}`}
          title={`모닥불 캠프 · ${dmTitle(dm, me.id)}`}
          icon={<Flame />}
          me={me}
          channelLabels={new Map([[dm.id, null]])}
          voiceLabels={new Map([[dm.id, { kind: 'call' as const, name: '통화 중' }]])}
          actions={backButton}
        />
      </PopoutShell>
    );
  }
  return (
    <PopoutShell title="광장">
      <p className="popout__status">이 광장을 볼 수 없습니다.</p>
    </PopoutShell>
  );
}
