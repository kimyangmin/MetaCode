import { Redirect, useGlobalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { completeSignIn } from '@/auth/session';

/**
 * metacode://auth?code= 로 앱이 열렸을 때. 보통은 로그인 창(Custom Tab)이 결과를 받지만,
 * 로그인하는 동안 앱이 꺼졌다 다시 켜지면 여기로 온다. 같은 코드는 한 번만 쓴다 (completeSignIn).
 */
export default function AuthRedirect() {
  const params = useGlobalSearchParams<{ code?: string; error?: string }>();
  useEffect(() => {
    const query = new URLSearchParams();
    if (params.code) query.set('code', params.code);
    if (params.error) query.set('error', params.error);
    if (query.toString()) void completeSignIn(`metacode://auth?${query.toString()}`);
  }, [params.code, params.error]);
  return <Redirect href="/" />;
}
