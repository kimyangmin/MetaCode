import type { UserProfile } from '@metacode/shared';
import { useEffect, useState } from 'react';
import { useIsOnline } from '../stores/presence';
import { displayName } from './format';

interface AvatarProps {
  user: UserProfile;
  size?: number;
  /** 온라인 여부 점을 함께 그린다 */
  showStatus?: boolean;
  /**
   * 움직이는 사진(GIF로 올린 사진)이면 움직이게 그린다. 멤버 목록·정보 팝업만 켜고,
   * 채팅 목록처럼 사진이 많이 모이는 곳은 멈춘 사진(첫 장면)을 쓴다.
   */
  animate?: boolean;
}

/** 불러오지 못한 사진을 다시 시도하는 간격. 마지막 간격을 계속 쓴다 */
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 60_000];

/** 다시 시도할 주소: 실패한 요청은 캐시되지 않지만, 같은 주소면 <img>가 다시 요청하지 않아서 표시를 붙인다 */
export function retryUrl(url: string, attempt: number): string {
  if (attempt === 0) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}retry=${attempt}`;
}

/** 사람마다 늘 같은 배경색 (사진을 못 불러왔을 때 첫 글자 뒤에 깐다) */
function fallbackColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(h) % 360} 45% 45%)`;
}

/**
 * 프로필 사진. 연결이 불안정해서 사진을 못 불러오면 깨진 그림 대신 이름 첫 글자를 보여 주고,
 * 잠시 뒤와 네트워크가 돌아왔을 때 다시 불러온다.
 */
export function Avatar({ user, size = 32, showStatus = false, animate = false }: AvatarProps) {
  const url = (animate && user.avatarAnimatedUrl) || user.avatarUrl;
  const [state, setState] = useState({ url, attempt: 0, failed: false });
  // 사진 주소가 바뀌면(사진을 바꿈) 처음부터 다시 불러온다.
  if (state.url !== url) setState({ url, attempt: 0, failed: false });

  useEffect(() => {
    if (!state.failed) return;
    const retry = () => setState((s) => ({ ...s, attempt: s.attempt + 1, failed: false }));
    const delay = RETRY_DELAYS_MS[Math.min(state.attempt, RETRY_DELAYS_MS.length - 1)];
    const timer = setTimeout(retry, delay);
    window.addEventListener('online', retry);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('online', retry);
    };
  }, [state.failed, state.attempt]);

  const initial = Array.from(displayName(user).trim())[0]?.toUpperCase() ?? '?';
  return (
    <span className="avatar" style={{ width: size, height: size }}>
      {state.failed ? (
        <span
          className="avatar__fallback"
          style={{ background: fallbackColor(user.id), fontSize: Math.max(10, size * 0.45) }}
          aria-hidden
        >
          {initial}
        </span>
      ) : (
        <img
          key={state.attempt}
          src={retryUrl(url, state.attempt)}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          onError={() => setState((s) => ({ ...s, failed: true }))}
        />
      )}
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
