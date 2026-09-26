import { useState } from 'react';
import { LoginScreen } from './features/auth/LoginScreen';
import { ProfileHeader } from './features/auth/ProfileHeader';
import { takeLoginError, useMe } from './features/auth/auth';
import { useRealtimeConnection } from './features/realtime/useRealtimeConnection';
import { getDesktopBridge } from './platform';

export function App() {
  const [loginError] = useState(takeLoginError);
  const me = useMe();
  const realtime = useRealtimeConnection(Boolean(me.data));

  if (me.isPending) return <main className="center">불러오는 중…</main>;
  if (me.isError) {
    return (
      <main className="center" role="alert">
        서버에 연결하지 못했습니다.
      </main>
    );
  }
  if (!me.data) return <LoginScreen error={loginError} />;

  const desktop = getDesktopBridge();
  return (
    <div className="app">
      <ProfileHeader me={me.data} status={realtime} />
      <main className="app__body">
        <p>Phase 2에서 커뮤니티와 채팅이 이 자리에 들어옵니다.</p>
        <p className="app__platform">
          {desktop ? `데스크톱 (${desktop.os}, Electron ${desktop.versions.electron})` : '웹'}
        </p>
      </main>
    </div>
  );
}
