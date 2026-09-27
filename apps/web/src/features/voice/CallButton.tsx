import { Avatar } from '../../ui/Avatar';
import { useCall, useVoiceStore } from './store';
import { LiveButton } from './VoiceMembers';
import { useVoice } from './VoiceProvider';

/** DM 머리글의 통화 버튼. 진행 중인 통화가 있으면 참여자와 함께 "참여"로 보인다 */
export function CallButton({ channelId }: { channelId: string }) {
  return (
    <>
      <LiveButtons channelId={channelId} />
      <CallToggle channelId={channelId} />
    </>
  );
}

/** DM에는 참여자 목록이 따로 없으므로, 화면을 공유 중인 사람의 LIVE를 머리글에 보여 준다 */
function LiveButtons({ channelId }: { channelId: string }) {
  const call = useCall(channelId);
  return (call?.members ?? [])
    .filter((m) => m.sharing)
    .map((m) => <LiveButton key={m.user.id} channelId={channelId} member={m} />);
}

function CallToggle({ channelId }: { channelId: string }) {
  const voice = useVoice();
  const call = useCall(channelId);
  const inThisCall = useVoiceStore((s) => s.session?.channelId === channelId);
  const members = call?.members ?? [];

  if (inThisCall) {
    return (
      <button
        type="button"
        className="call-button call-button--active"
        onClick={() => voice.leave()}
      >
        <MemberStack members={members} />
        통화 나가기
      </button>
    );
  }
  return (
    <button
      type="button"
      className="call-button"
      data-live={members.length > 0}
      onClick={() => void voice.join(channelId)}
      title={members.length > 0 ? '진행 중인 통화에 참여' : '통화 시작'}
    >
      <MemberStack members={members} />
      📞 {members.length > 0 ? `통화 참여 (${members.length})` : '통화'}
    </button>
  );
}

function MemberStack({ members }: { members: { user: Parameters<typeof Avatar>[0]['user'] }[] }) {
  if (members.length === 0) return null;
  return (
    <span className="call-button__avatars" aria-hidden>
      {members.slice(0, 3).map((m) => (
        <Avatar key={m.user.id} user={m.user} size={18} />
      ))}
    </span>
  );
}
