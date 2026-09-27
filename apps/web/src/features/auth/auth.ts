import { AuthClient, type UserDetail } from '@metacode/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ApiError, apiFetch } from '../../api/client';
import { API_URL } from '../../config';
import { getDesktopBridge } from '../../platform';

export const meQueryKey = ['me'] as const;

/** 로그인한 사용자. 로그인 전이면 null */
export function useMe() {
  const queryClient = useQueryClient();

  // 데스크톱은 로그인이 시스템 브라우저에서 끝나므로 메인 프로세스의 알림을 받아 다시 조회한다.
  useEffect(() => {
    return getDesktopBridge()?.auth.onChanged(() => {
      void queryClient.invalidateQueries({ queryKey: meQueryKey });
    });
  }, [queryClient]);

  return useQuery({
    queryKey: meQueryKey,
    queryFn: async (): Promise<UserDetail | null> => {
      try {
        return await apiFetch<UserDetail>('/users/me');
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    // 로그인이 안 된 것(401)은 바로 로그인 화면으로, 서버에 닿지 않은 것은 몇 번 더 시도한다
    // (앱을 막 켜서 네트워크가 아직 없을 때 등). 그래도 안 되면 "연결하지 못했습니다"와 다시 시도 버튼을 보여 준다.
    retry: (failures, error) =>
      failures < 3 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
    staleTime: 5 * 60 * 1000,
  });
}

export async function login(): Promise<void> {
  const desktop = getDesktopBridge();
  if (desktop) {
    await desktop.auth.login();
    return;
  }
  window.location.assign(`${API_URL}/auth/github?client=${AuthClient.Web}`);
}

export async function logout(): Promise<void> {
  const desktop = getDesktopBridge();
  if (desktop) {
    await desktop.auth.logout();
    return;
  }
  await fetch(`${API_URL}/auth/logout`, { method: 'POST', credentials: 'include' });
}

const LOGIN_ERROR_MESSAGES: Record<string, string> = {
  access_denied: 'GitHub에서 로그인을 취소했습니다.',
  invalid_state: '로그인 요청이 만료되었습니다. 다시 시도해 주세요.',
  github_error: 'GitHub와 통신하지 못했습니다. 잠시 후 다시 시도해 주세요.',
};

/** 로그인 실패 후 돌아온 주소의 ?login_error=를 읽고 주소에서 지운다. */
export function takeLoginError(): string | null {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('login_error');
  if (!code) return null;
  url.searchParams.delete('login_error');
  window.history.replaceState(null, '', url);
  return LOGIN_ERROR_MESSAGES[code] ?? '로그인하지 못했습니다.';
}
