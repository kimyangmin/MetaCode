import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { useSession } from '@/auth/session';
import { InviteScreen } from '@/features/invites/InviteScreen';
import { isInviteCode, usePendingInvite } from '@/stores/pendingInvite';

/**
 * metacode://invite/<코드> 로 앱이 열렸을 때 (데스크톱 앱과 같은 주소). 로그인 전이면 코드를 기억해 두고
 * 처음 화면(로그인)으로, 로그인 뒤에 이 화면으로 돌아온다 ((main) 레이아웃이 이어 감).
 */
export default function InviteRoute() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const status = useSession((s) => s.status);
  const valid = isInviteCode(code);
  const signedIn = status === 'signedIn';

  useEffect(() => {
    if (valid && status !== 'loading' && !signedIn) usePendingInvite.setState({ code });
  }, [valid, status, signedIn, code]);

  if (!valid) return <Redirect href="/" />;
  if (status === 'loading') return null;
  if (!signedIn) return <Redirect href="/" />;
  return <InviteScreen code={code} />;
}
