import type { UserProfile } from '@metacode/shared';
import { useQueryClient } from '@tanstack/react-query';
import type { RealtimeStatus } from '../realtime/useRealtimeConnection';
import { logout, meQueryKey } from './auth';

const STATUS_LABEL: Record<RealtimeStatus, string> = {
  connected: '온라인',
  connecting: '연결 중',
  disconnected: '오프라인',
};

export function ProfileHeader({ me, status }: { me: UserProfile; status: RealtimeStatus }) {
  const queryClient = useQueryClient();

  const onLogout = async () => {
    await logout();
    queryClient.setQueryData(meQueryKey, null);
  };

  return (
    <header className="profile">
      <img className="profile__avatar" src={me.avatarUrl} alt="" width={40} height={40} />
      <div className="profile__names">
        <strong>{me.displayName ?? me.username}</strong>
        <span className="profile__username">@{me.username}</span>
      </div>
      <span className="profile__status" data-status={status}>
        {STATUS_LABEL[status]}
      </span>
      <button className="button" onClick={onLogout}>
        로그아웃
      </button>
    </header>
  );
}
