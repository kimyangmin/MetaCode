import type { VoiceMember } from '@metacode/shared';
import { useState } from 'react';
import { Avatar } from '../../ui/Avatar';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { openProfile } from '../../stores/profile';
import { displayName } from '../../ui/format';
import { useSharePreview } from './SharePreview';
import { useVoiceStore } from './store';
import { useVoice } from './VoiceProvider';
import { HeadphoneOff, MicOff } from 'lucide-react';

/**
 * 통화 참여자 목록 (채팅 모드). 말하는 사람은 테두리로 강조하고, 음소거·헤드셋 끔을 표시한다.
 * 말하는 중은 내가 그 통화에 들어가 있을 때만 보인다 (밖에서는 누가 있는지만 보인다).
 * 화면을 공유 중이면 LIVE를 눌러 볼 수 있다.
 */
export function VoiceMembers({
  channelId,
  members,
}: {
  channelId: string;
  members: VoiceMember[];
}) {
  const inCall = useVoiceStore((s) => s.session?.channelId === channelId);
  if (members.length === 0) return null;
  return (
    <ul className="voice-members" aria-label="통화 참여자">
      {members.map((member) => (
        <MemberRow key={member.user.id} channelId={channelId} member={member} inCall={inCall} />
      ))}
    </ul>
  );
}

/** 참여자 한 명. 화면을 공유 중이면 마우스를 올려 미리 본다 */
function MemberRow({
  channelId,
  member,
  inCall,
}: {
  channelId: string;
  member: VoiceMember;
  inCall: boolean;
}) {
  const { hoverProps, popup } = useSharePreview(channelId, member);
  return (
    <li
      className="voice-members__item"
      data-speaking={inCall && member.speaking && !member.muted}
      {...hoverProps}
    >
      <button
        type="button"
        className="voice-members__who"
        onClick={(e) => openProfile(member.user, e)}
        title={`${displayName(member.user)} 정보`}
      >
        <Avatar user={member.user} size={22} />
        <span className="voice-members__name">{displayName(member.user)}</span>
      </button>
      {member.sharing && <LiveButton channelId={channelId} member={member} />}
      <MemberFlags member={member} />
      {popup}
    </li>
  );
}

/**
 * 화면 공유 보기. 그 통화에 없으면 먼저 들어간다 (마이크는 끈 채로).
 * 다른 통화에 들어가 있으면 옮길지 먼저 묻는다 (한 사람은 통화 하나에만 있을 수 있다).
 */
export function LiveButton({ channelId, member }: { channelId: string; member: VoiceMember }) {
  const voice = useVoice();
  const otherCall = useVoiceStore((s) =>
    s.session && s.session.channelId !== channelId ? s.session.channelId : null,
  );
  const [confirming, setConfirming] = useState(false);
  const watch = () => {
    setConfirming(false);
    void voice.watch(channelId, member.user.id);
  };
  return (
    <>
      <button
        type="button"
        className="live-badge"
        onClick={() => (otherCall ? setConfirming(true) : watch())}
        title={`${displayName(member.user)}의 화면 보기`}
      >
        LIVE
      </button>
      {confirming && (
        <ConfirmDialog
          title="다른 통화로 옮길까요?"
          confirmLabel="옮기고 보기"
          onConfirm={watch}
          onCancel={() => setConfirming(false)}
        >
          {displayName(member.user)}님의 화면을 보려면 지금 통화에서 나와 그 통화에 들어가야 합니다.
          마이크는 꺼진 채로 들어갑니다.
        </ConfirmDialog>
      )}
    </>
  );
}

export function MemberFlags({ member }: { member: Pick<VoiceMember, 'muted' | 'deafened'> }) {
  if (member.deafened) {
    return (
      <span className="voice-flag" title="헤드셋 끔">
        <HeadphoneOff role="img" aria-label="헤드셋 끔" />
      </span>
    );
  }
  if (member.muted) {
    return (
      <span className="voice-flag" title="마이크 음소거">
        <MicOff role="img" aria-label="마이크 음소거" />
      </span>
    );
  }
  return null;
}
