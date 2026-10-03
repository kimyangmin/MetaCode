import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { RouterProvider } from 'react-router';
import { OpenInApp } from './features/desktop/OpenInApp';
import { inviteToOpenInApp, stayInBrowser } from './features/desktop/inviteLink';
import { getDesktopBridge, isAndroidApp, loadAndroid } from './platform';
import { LiveUpdateNotice } from './features/app/LiveUpdateNotice';
import { LoginScreen } from './features/auth/LoginScreen';
import { TitleBar } from './features/desktop/TitleBar';
import { UpdateNotice } from './features/desktop/UpdateNotice';
import { loginErrorMessage, meQueryKey, takeLoginError, useMe } from './features/auth/auth';
import { rememberPendingInvite } from './pages';
import { AssetEditors } from './features/assets/AssetEditors';
import { listenAssetsChanged } from './features/assets/editorWindow';
import { SettingsDialog } from './features/settings/SettingsDialog';
import { ScreenViewer } from './features/voice/ScreenViewer';
import { VoiceProvider } from './features/voice/VoiceProvider';
import { RealtimeProvider } from './realtime/RealtimeProvider';
import { createAppRouter } from './router';
import { useColorSchemeSync } from './stores/colorScheme';
import { useUiStore } from './stores/ui';

export function App() {
  useColorSchemeSync();
  return (
    <>
      <Screen />
      <UpdateNotice />
      <LiveUpdateNotice />
    </>
  );
}

function Screen() {
  const [loginError, setLoginError] = useState(takeLoginError);
  const [router] = useState(createAppRouter);
  const [openInApp, setOpenInApp] = useState(inviteToOpenInApp);
  const queryClient = useQueryClient();
  const me = useMe();

  // 다른 창(새 창으로 띄운 에디터 등)에서 에셋·맵을 저장하면 이 창의 목록도 다시 받는다.
  useEffect(() => listenAssetsChanged(queryClient), [queryClient]);
  const loggedIn = !!me.data;
  const loggedInRef = useRef(loggedIn);
  useEffect(() => {
    loggedInRef.current = loggedIn;
  }, [loggedIn]);

  // 데스크톱: 이미 켜진 앱에 초대 링크(metacode://)가 오면 새로 고치지 않고 그 화면으로 옮긴다.
  // 로그인 전이면 로그인 뒤에 이어 가도록 기억해 둔다.
  useEffect(
    () =>
      getDesktopBridge()?.navigation?.onNavigate((route) => {
        void router.navigate(route).then(() => {
          if (!loggedIn) rememberPendingInvite();
        });
      }),
    [router, loggedIn],
  );

  // 안드로이드 앱: metacode:// 주소(로그인 결과, 초대 링크)와 뒤로 가기 버튼을 받는다.
  useEffect(() => {
    if (!isAndroidApp()) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    void loadAndroid().then((android) => {
      if (cancelled) return;
      const stopLinks = android.listenAppLinks({
        onLogin: () => {
          setLoginError(null);
          void queryClient.invalidateQueries({ queryKey: meQueryKey });
        },
        onLoginError: (reason) => setLoginError(loginErrorMessage(reason)),
        onNavigate: (route) =>
          void router.navigate(route).then(() => {
            if (!loggedInRef.current) rememberPendingInvite();
          }),
      });
      const stopBack = android.listenBackButton(closeTopOverlay);
      stop = () => {
        stopLinks();
        stopBack();
      };
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [router, queryClient]);

  // 데스크톱 앱(0.5.0부터)은 OS 제목 표시줄 대신 이것을 그린다. 브라우저에서는 아무것도 그리지 않는다.
  return (
    <>
      <TitleBar router={router} loggedIn={loggedIn} />
      {renderScreen()}
    </>
  );

  function renderScreen() {
    if (openInApp) {
      return (
        <OpenInApp
          code={openInApp}
          onContinue={() => {
            stayInBrowser(openInApp);
            setOpenInApp(null);
          }}
        />
      );
    }

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
}

/**
 * 안드로이드 뒤로 가기: 열린 서랍을 닫거나, 떠 있는 창(설정, 대화 상자, 정보 팝업 등)에 Esc를 보내 닫는다.
 * 닫은 것이 있으면 true (앞 화면으로 가지 않는다).
 */
function closeTopOverlay(): boolean {
  const ui = useUiStore.getState();
  if (ui.navOpen || ui.membersDrawerOpen) {
    ui.closeDrawers();
    return true;
  }
  if (document.querySelector('[role="dialog"], [role="alertdialog"]')) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    return true;
  }
  return false;
}
