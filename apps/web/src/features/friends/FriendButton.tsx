import type { UserProfile } from '@metacode/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../../api/client';
import { acceptFriend, friendStatusOf, removeFriend, sendFriendRequest, useFriends } from './api';

/** 사용자 정보 팝업의 친구 버튼: 친구 추가 / 요청 취소 / 요청 수락 / 친구 끊기 */
export function FriendButton({ user }: { user: UserProfile }) {
  const queryClient = useQueryClient();
  const friends = useFriends();
  const status = friendStatusOf(friends.data, user.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '처리하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="friend-button">
      {status === 'none' && (
        <button
          type="button"
          className="button"
          disabled={busy || friends.isPending}
          onClick={() => void run(() => sendFriendRequest(queryClient, user.username))}
        >
          친구 추가
        </button>
      )}
      {status === 'outgoing' && (
        <button
          type="button"
          className="button"
          disabled={busy}
          title="보낸 친구 요청 취소"
          onClick={() => void run(() => removeFriend(queryClient, user.id))}
        >
          요청 보냄 · 취소
        </button>
      )}
      {status === 'incoming' && (
        <button
          type="button"
          className="button button--primary"
          disabled={busy}
          onClick={() => void run(() => acceptFriend(queryClient, user.id))}
        >
          친구 요청 수락
        </button>
      )}
      {status === 'friends' && (
        <button
          type="button"
          className="button"
          disabled={busy}
          title="친구 끊기"
          onClick={() => {
            if (window.confirm('친구를 끊을까요?')) {
              void run(() => removeFriend(queryClient, user.id));
            }
          }}
        >
          ✓ 친구
        </button>
      )}
      {error && <p className="form__error">{error}</p>}
    </div>
  );
}
