import type { DesktopUpdateInfo } from '@metacode/shared';
import { useEffect, useState } from 'react';
import { getDesktopBridge } from '../platform';

/** 자동 업데이트가 없는 0.1.0 앱에 보여 줄 내려받기 주소 */
const RELEASES_URL = 'https://github.com/kimyangmin/MetaCode/releases/latest';
const LEGACY_DISMISSED_KEY = 'metacode:legacy-update-dismissed';

function isPopout() {
  return location.pathname.startsWith('/popout/') || location.hash.startsWith('#/popout/');
}

/**
 * 데스크톱 앱 업데이트 안내 (메인 창에만, 브라우저에서는 아무것도 없음).
 * - 새 버전을 다 받았으면 "다시 시작"을 권한다. 나중에를 눌러도 앱을 끌 때 설치된다.
 * - 자동 업데이트가 없는 옛 앱(0.1.0)이면 새로 설치하라고 한 번 알린다.
 */
export function UpdateNotice() {
  const bridge = getDesktopBridge();
  if (!bridge || isPopout()) return null;
  return bridge.update ? <UpdateReady /> : <LegacyAppNotice />;
}

function UpdateReady() {
  const [ready, setReady] = useState<DesktopUpdateInfo | null>(null);
  const [later, setLater] = useState(false);

  useEffect(() => {
    const update = getDesktopBridge()?.update;
    if (!update) return;
    let active = true;
    // 화면을 새로 열었으면 이미 받아 둔 버전을 놓쳤을 수 있다.
    void update.getReady().then((info) => active && info && setReady(info));
    const off = update.onReady(setReady);
    return () => {
      active = false;
      off();
    };
  }, []);

  if (!ready || later) return null;
  return (
    <div className="update-notice" role="status">
      <span>새 버전({ready.version})이 준비되었습니다.</span>
      <button
        type="button"
        className="button button--primary"
        onClick={() => void getDesktopBridge()?.update?.install()}
      >
        지금 다시 시작
      </button>
      <button
        type="button"
        className="button"
        onClick={() => setLater(true)}
        title="앱을 끌 때 설치됩니다"
      >
        나중에
      </button>
    </div>
  );
}

function LegacyAppNotice() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(LEGACY_DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(LEGACY_DISMISSED_KEY, '1');
    } catch {
      // 기억하지 못하면 다음에 한 번 더 보일 뿐이다.
    }
  };

  if (dismissed) return null;
  return (
    <div className="update-notice" role="status">
      <span>
        새 데스크톱 앱이 나왔습니다. 이 버전은 자동으로 업데이트되지 않으니 한 번만 새로 설치해
        주세요.
      </span>
      <a className="button button--primary" href={RELEASES_URL} target="_blank" rel="noreferrer">
        내려받기
      </a>
      <button type="button" className="icon-button" onClick={dismiss} aria-label="닫기">
        ×
      </button>
    </div>
  );
}
