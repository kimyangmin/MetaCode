import { useEffect } from 'react';
import {
  Navigate,
  Outlet,
  createBrowserRouter,
  createHashRouter,
  useLocation,
  useNavigate,
} from 'react-router';
import { CommunityRail } from './features/communities/CommunityRail';
import { ProfilePopup } from './features/communities/ProfilePopup';
import { CommunityPage, DmPage, HomeRedirect, InvitePage, takePendingInvite } from './pages';
import { isDesktop } from './platform';

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

  return (
    <div className="app">
      <CommunityRail />
      <Outlet />
      <ProfilePopup />
    </div>
  );
}

const routes = [
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
