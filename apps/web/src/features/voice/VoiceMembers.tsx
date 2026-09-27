import type { VoiceMember } from '@metacode/shared';
import { Avatar } from '../../ui/Avatar';
import { displayName } from '../../ui/format';
import { useVoice } from './VoiceProvider';

/**
 * 통화 참여자 목록 (채팅 모드). 말하는 사람은 테두리로 강조하고, 음소거·헤드셋 끔을 표시한다.
 * 화면을 공유 중이면 LIVE를 눌러 볼 수 있다.
 */
export function VoiceMembers({
  channelId,
  members,
}: {
  channelId: string;
  members: VoiceMember[];
}) {
  if (members.length === 0) return null;
  return (
    <ul className="voice-members" aria-label="통화 참여자">
      {members.map((member) => (
        <li
          key={member.user.id}
          className="voice-members__item"
          data-speaking={member.speaking && !member.muted}
        >
          <Avatar user={member.user} size={22} />
          <span className="voice-members__name">{displayName(member.user)}</span>
          {member.sharing && <LiveButton channelId={channelId} member={member} />}
          <MemberFlags member={member} />
        </li>
      ))}
    </ul>
  );
}

/** 화면 공유 보기. 그 통화에 없으면 먼저 들어간다 */
export function LiveButton({ channelId, member }: { channelId: string; member: VoiceMember }) {
  const voice = useVoice();
  return (
    <button
      type="button"
      className="live-badge"
      onClick={() => void voice.watch(channelId, member.user.id)}
      title={`${displayName(member.user)}의 화면 보기`}
    >
      LIVE
    </button>
  );
}

export function MemberFlags({ member }: { member: Pick<VoiceMember, 'muted' | 'deafened'> }) {
  if (member.deafened) {
    return (
      <span className="voice-flag" role="img" aria-label="헤드셋 끔" title="헤드셋 끔">
        🔕
      </span>
    );
  }
  if (member.muted) {
    return (
      <span className="voice-flag" role="img" aria-label="마이크 음소거" title="마이크 음소거">
        🔇
      </span>
    );
  }
  return null;
}
