import type { VoiceMember } from '@metacode/shared';
import { Avatar } from '../../ui/Avatar';
import { displayName } from '../../ui/format';

/** 통화 참여자 목록 (채팅 모드). 말하는 사람은 테두리로 강조하고, 음소거·헤드셋 끔을 표시한다 */
export function VoiceMembers({ members }: { members: VoiceMember[] }) {
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
          <MemberFlags member={member} />
        </li>
      ))}
    </ul>
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
