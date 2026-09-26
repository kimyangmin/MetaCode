import type { UserProfile } from '@metacode/shared';
import { useIsOnline } from '../stores/presence';

interface AvatarProps {
  user: UserProfile;
  size?: number;
  /** 온라인 여부 점을 함께 그린다 */
  showStatus?: boolean;
}

export function Avatar({ user, size = 32, showStatus = false }: AvatarProps) {
  return (
    <span className="avatar" style={{ width: size, height: size }}>
      <img src={user.avatarUrl} alt="" width={size} height={size} loading="lazy" />
      {showStatus && <StatusDot userId={user.id} />}
    </span>
  );
}

function StatusDot({ userId }: { userId: string }) {
  const online = useIsOnline(userId);
  return (
    <span
      className="avatar__status"
      data-online={online}
      role="img"
      aria-label={online ? '온라인' : '오프라인'}
    />
  );
}
