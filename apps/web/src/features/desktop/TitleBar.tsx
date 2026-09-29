import { useQuery } from '@tanstack/react-query';
import { CircleHelp, Copy, Minus, Square, X } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { createAppRouter } from '../../router';
import { fetchCommunities, queryKeys } from '../../api/queries';
import { getDesktopBridge } from '../../platform';
import { useSettingsStore } from '../../stores/settings';

type AppRouter = ReturnType<typeof createAppRouter>;

/** 지금 화면의 제목: 커뮤니티면 그 이름, DM이면 Direct Message, 그 밖에는 MetaCode */
export function titleFor(
  pathname: string,
  communities: readonly { id: string; name: string }[] | undefined,
): string {
  if (pathname === '/dm' || pathname.startsWith('/dm/')) return 'Direct Message';
  const match = /^\/c\/([^/]+)/.exec(pathname);
  const community = match && communities?.find((c) => c.id === match[1]);
  return community ? community.name : 'MetaCode';
}

/**
 * 데스크톱 앱의 제목 표시줄 (0.5.0부터 OS 제목 표시줄과 메뉴 막대 대신 이것을 그린다).
 * 왼쪽: 도움말(설정 → 기능) / 가운데: 지금 커뮤니티 이름 또는 Direct Message / 오른쪽: 최소화, 최대화, 닫기.
 * 빈 곳을 끌면 창이 옮겨지고 두 번 누르면 최대화된다 (-webkit-app-region: drag, OS가 처리하므로
 * 그 자리에서는 마우스 이벤트가 오지 않는다. 버튼만 no-drag).
 * 브라우저와 옛 앱(브리지에 window가 없음)에서는 그리지 않는다.
 */
export function TitleBar({ router, loggedIn }: { router: AppRouter; loggedIn: boolean }) {
  const controls = getDesktopBridge()?.window;
  const pathname = useSyncExternalStore(router.subscribe, () => router.state.location.pathname);
  const communities = useQuery({
    queryKey: queryKeys.communities,
    queryFn: fetchCommunities,
    staleTime: Infinity,
    enabled: loggedIn && !!controls,
  });
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!controls) return;
    // 창 높이에서 제목 표시줄만큼 빼도록 알린다 (styles.css의 --titlebar-h).
    document.documentElement.dataset.titlebar = controls.nativeControls ? 'mac' : 'custom';
    void controls.isMaximized().then(setMaximized);
    const stop = controls.onMaximizedChange(setMaximized);
    return () => {
      stop();
      delete document.documentElement.dataset.titlebar;
    };
  }, [controls]);

  if (!controls) return null;
  const title = loggedIn ? titleFor(pathname, communities.data) : 'MetaCode';

  return (
    <header className="titlebar">
      <div className="titlebar__side">
        {loggedIn && (
          <button
            type="button"
            className="titlebar__button"
            onClick={() => useSettingsStore.getState().open('features')}
            aria-label="도움말 (단축키, 마크다운)"
            title="도움말"
          >
            <CircleHelp aria-hidden />
          </button>
        )}
      </div>
      <h1 className="titlebar__title">{title}</h1>
      <div className="titlebar__side titlebar__side--end">
        {!controls.nativeControls && (
          <>
            <button
              type="button"
              className="titlebar__button"
              onClick={() => void controls.minimize()}
              aria-label="최소화"
              title="최소화"
            >
              <Minus aria-hidden />
            </button>
            <button
              type="button"
              className="titlebar__button"
              onClick={() => void controls.toggleMaximize()}
              aria-label={maximized ? '이전 크기로' : '최대화'}
              title={maximized ? '이전 크기로' : '최대화'}
            >
              {maximized ? <Copy aria-hidden /> : <Square aria-hidden />}
            </button>
            <button
              type="button"
              className="titlebar__button titlebar__button--close"
              onClick={() => void controls.close()}
              aria-label="닫기"
              title="닫기"
            >
              <X aria-hidden />
            </button>
          </>
        )}
      </div>
    </header>
  );
}
