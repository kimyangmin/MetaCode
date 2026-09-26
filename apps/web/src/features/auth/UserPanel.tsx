import type { UserProfile } from '@metacode/shared';
import { useQueryClient } from '@tanstack/react-query';
import { type RealtimeStatus, useRealtime } from '../../realtime/RealtimeProvider';
import { Avatar } from '../../ui/Avatar';
import { displayName } from '../../ui/format';
import { logout, meQueryKey } from './auth';

const STATUS_LABEL: Record<RealtimeStatus, string> = {
  connected: '온라인',
  connecting: '연결 중',
  disconnected: '오프라인',
};

/** 사이드바 아래: 내 프로필, 연결 상태, 로그아웃 */
export function UserPanel({ me }: { me: UserProfile }) {
  const queryClient = useQueryClient();
  const { status } = useRealtime();

  const onLogout = async () => {
    await logout();
    // 먼저 로그아웃 상태로 바꿔 로그인 화면으로 돌아간 뒤, 이전 사용자의 데이터를 지운다.
    // clear()를 쓰면 App이 구독 중인 'me' 쿼리까지 사라져 화면이 바뀌지 않는다.
    queryClient.setQueryData(meQueryKey, null);
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== meQueryKey[0] });
  };

  return (
    <footer className="user-panel">
      <Avatar user={me} size={32} />
      <div className="user-panel__names">
        <strong>{displayName(me)}</strong>
        <span className="user-panel__status" data-status={status}>
          {STATUS_LABEL[status]}
        </span>
      </div>
      <button className="icon-button" onClick={onLogout} title="로그아웃" aria-label="로그아웃">
        ⎋
      </button>
    </footer>
  );
}
