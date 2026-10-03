import { type MouseEvent, type ReactNode, Suspense, lazy, useEffect, useRef } from 'react';
import {
  Navigate,
  Outlet,
  createBrowserRouter,
  createHashRouter,
  useLocation,
  useNavigate,
} from 'react-router';
import { CommunityRail } from './features/communities/CommunityRail';
import { useCommunities } from './features/communities/hooks';
import { ProfilePopup } from './features/communities/ProfilePopup';
import { PopoutChat, PopoutPlaza } from './layout/Popout';
import { shortcutTarget } from './layout/navShortcuts';
import { useDrawerSwipe } from './layout/drawerSwipe';
import { CommunityPage, DmPage, HomeRedirect, InvitePage, takePendingInvite } from './pages';
import { isDesktop } from './platform';
import { useUiStore } from './stores/ui';

/** 로그인 후 화면의 뼈대: 왼쪽 커뮤니티 막대 + 선택한 화면 */
function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  // 로그인 전에 열었던 초대 링크로 이어 간다.
  useEffect(() => {
    const code = takePendingInvite();
    if (code && !location.pathname.startsWith('/invite/')) {
      navigate(`/invite/${code}`, { replace: true });
    }
  }, [location.pathname, navigate]);

  // Ctrl+1은 DM, Ctrl+2~9·0은 왼쪽 목록 순서대로 커뮤니티. 떠 있는 창(설정, 에디터 등)이 있으면 옮기지 않는다.
  const communities = useCommunities().data;
  useEffect(() => {
    const ids = communities?.map((c) => c.id) ?? [];
    const onKey = (e: KeyboardEvent) => {
      const target = shortcutTarget(e, ids);
      if (!target) return;
      // 브라우저의 탭 옮기기(Ctrl+숫자)보다 먼저 받는다.
      e.preventDefault();
      if (document.querySelector('[aria-modal="true"]')) return;
      if (!location.pathname.startsWith(target)) void navigate(target);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [communities, location.pathname, navigate]);

  // 좁은 화면의 서랍. 멤버 목록은 다른 화면으로 옮기면 닫는다. 커뮤니티·채널 목록은 커뮤니티나 DM을
  // 오가는 동안 열어 두고, 목록에서 채널·대화를 고르면 닫는다 (onNavClick).
  const navOpen = useUiStore((s) => s.navOpen);
  const membersOpen = useUiStore((s) => s.membersDrawerOpen);
  useEffect(() => useUiStore.getState().setMembersDrawer(false), [location.pathname]);
  const appRef = useRef<HTMLDivElement>(null);
  useDrawerSwipe(appRef);
  const onNavClick = (e: MouseEvent) => {
    if ((e.target as Element).closest('.sidebar a[href]')) useUiStore.getState().setNavOpen(false);
  };

  return (
    <div
      ref={appRef}
      className="app"
      data-nav-open={navOpen}
      data-members-open={membersOpen}
      onClick={onNavClick}
    >
      <CommunityRail />
      <Outlet />
      {/* 좁은 화면에서 서랍(목록, 멤버)을 열면 나머지를 어둡게 덮고, 누르면 닫는다 */}
      <div
        className="app__backdrop"
        aria-hidden
        onClick={() => useUiStore.getState().closeDrawers()}
      />
      <ProfilePopup />
    </div>
  );
}

// 에디터만 띄운 창은 내장 에셋을 쓰므로 열 때 따로 불러온다.
const PopoutAssetEditor = lazy(() =>
  import('./features/assets/PopoutEditor').then((m) => ({ default: m.PopoutAssetEditor })),
);
const PopoutMapEditor = lazy(() =>
  import('./features/assets/PopoutEditor').then((m) => ({ default: m.PopoutMapEditor })),
);
const lazyPage = (page: ReactNode) => <Suspense fallback={null}>{page}</Suspense>;

const routes = [
  // 분리한 창 (채팅이나 광장 하나만)
  { path: '/popout/chat/:channelId', element: <PopoutChat /> },
  { path: '/popout/plaza/:plazaId', element: <PopoutPlaza /> },
  // 에디터만 띄운 창 (메인 창과 따로 그리면서 채팅·광장을 볼 수 있게)
  { path: '/popout/editor/asset/:assetId', element: lazyPage(<PopoutAssetEditor />) },
  { path: '/popout/editor/new/:kind', element: lazyPage(<PopoutAssetEditor />) },
  { path: '/popout/map/:communityId', element: lazyPage(<PopoutMapEditor />) },
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <HomeRedirect /> },
      { path: 'dm', element: <DmPage /> },
      { path: 'dm/:channelId', element: <DmPage /> },
      { path: 'c/:communityId', element: <CommunityPage /> },
      { path: 'c/:communityId/:channelId', element: <CommunityPage /> },
      { path: 'invite/:code', element: <InvitePage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
];

/** 웹은 일반 주소, 데스크톱은 file://로 열리므로 해시 주소(#/c/...)를 쓴다. */
export const createAppRouter = () =>
  isDesktop() ? createHashRouter(routes) : createBrowserRouter(routes);
