import type { UserProfile } from '@metacode/shared';
import { type RealtimeStatus, useRealtime } from '../../realtime/RealtimeProvider';
import { useSettingsStore } from '../../stores/settings';
import { Avatar } from '../../ui/Avatar';
import { displayName } from '../../ui/format';
import { VoicePanel } from '../voice/VoicePanel';
import { Settings } from 'lucide-react';

const STATUS_LABEL: Record<RealtimeStatus, string> = {
  connected: '온라인',
  connecting: '연결 중',
  disconnected: '오프라인',
};

/** 사이드바 아래: 통화 중이면 음성 패널, 내 프로필, 연결 상태, 설정 (로그아웃은 설정 안에) */
export function UserPanel({ me }: { me: UserProfile }) {
  const { status } = useRealtime();

  return (
    <>
      <VoicePanel meId={me.id} />
      <footer className="user-panel">
        <Avatar user={me} size={32} />
        <div className="user-panel__names">
          <strong>{displayName(me)}</strong>
          <span className="user-panel__status" data-status={status}>
            {STATUS_LABEL[status]}
          </span>
        </div>
        <button
          className="icon-button"
          onClick={() => useSettingsStore.getState().open()}
          title="설정"
          aria-label="설정"
        >
          <Settings aria-hidden />
        </button>
      </footer>
    </>
  );
}
