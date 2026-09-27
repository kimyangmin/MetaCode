import { useState } from 'react';
import { RouterProvider } from 'react-router';
import { LoginScreen } from './features/auth/LoginScreen';
import { takeLoginError, useMe } from './features/auth/auth';
import { rememberPendingInvite } from './pages';
import { ScreenViewer } from './features/voice/ScreenViewer';
import { VoiceProvider } from './features/voice/VoiceProvider';
import { RealtimeProvider } from './realtime/RealtimeProvider';
import { createAppRouter } from './router';

export function App() {
  const [loginError] = useState(takeLoginError);
  const [router] = useState(createAppRouter);
  const me = useMe();

  if (me.isPending) return <main className="center">불러오는 중…</main>;
  if (me.isError) {
    return (
      <main className="center" role="alert">
        서버에 연결하지 못했습니다.
      </main>
    );
  }
  if (!me.data) {
    rememberPendingInvite();
    return <LoginScreen error={loginError} />;
  }

  return (
    <RealtimeProvider key={me.data.id} meId={me.data.id}>
      <VoiceProvider meId={me.data.id}>
        <RouterProvider router={router} />
        <ScreenViewer />
      </VoiceProvider>
    </RealtimeProvider>
  );
}
