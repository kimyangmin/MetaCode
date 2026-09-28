import { useState } from 'react';
import { RouterProvider } from 'react-router';
import { LiveUpdateNotice } from './features/app/LiveUpdateNotice';
import { LoginScreen } from './features/auth/LoginScreen';
import { UpdateNotice } from './features/desktop/UpdateNotice';
import { takeLoginError, useMe } from './features/auth/auth';
import { rememberPendingInvite } from './pages';
import { AssetEditors } from './features/assets/AssetEditors';
import { SettingsDialog } from './features/settings/SettingsDialog';
import { ScreenViewer } from './features/voice/ScreenViewer';
import { VoiceProvider } from './features/voice/VoiceProvider';
import { RealtimeProvider } from './realtime/RealtimeProvider';
import { createAppRouter } from './router';

export function App() {
  return (
    <>
      <Screen />
      <UpdateNotice />
      <LiveUpdateNotice />
    </>
  );
}

function Screen() {
  const [loginError] = useState(takeLoginError);
  const [router] = useState(createAppRouter);
  const me = useMe();

  if (me.isPending) return <main className="center">불러오는 중…</main>;
  if (me.isError) {
    return (
      <main className="center center--column" role="alert">
        <p>서버에 연결하지 못했습니다.</p>
        <button
          type="button"
          className="button button--primary"
          onClick={() => void me.refetch()}
          disabled={me.isFetching}
        >
          {me.isFetching ? '연결 중…' : '다시 시도'}
        </button>
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
        <SettingsDialog />
        <AssetEditors />
      </VoiceProvider>
    </RealtimeProvider>
  );
}
