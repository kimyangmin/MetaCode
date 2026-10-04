import type { UpdateReadyInfo } from '@metacode/shared';
import { type ReactNode, useEffect, useState } from 'react';
import { ANDROID_DOWNLOAD_URL, DESKTOP_DOWNLOAD_URL } from '../../config';
import { getDesktopBridge, isAndroidApp, loadAndroid } from '../../platform';
import { X } from 'lucide-react';

/**
 * 데스크톱 앱 업데이트 안내. 메인 프로세스가 새 버전을 다 받아 두면 "다시 시작"을 띄운다
 * (누르지 않아도 앱을 끌 때 설치된다). 자동 업데이트가 없는 옛 앱(0.2.0 이하)에는 설치 파일 받는 곳을 알려 준다.
 * 웹을 감싼 예전 안드로이드 앱(Capacitor)에는 새 네이티브 앱을 받으라고 알린다. 브라우저에서는 아무것도 그리지 않는다.
 */
export function UpdateNotice() {
  const desktop = getDesktopBridge();
  const updates = desktop?.updates;
  const [ready, setReady] = useState<UpdateReadyInfo | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    if (!updates) return;
    let active = true;
    void updates.getReady().then((info) => {
      if (active && info) setReady(info);
    });
    const off = updates.onReady(setReady);
    return () => {
      active = false;
      off();
    };
  }, [updates]);

  if (isAndroidApp()) {
    if (dismissed === 'android') return null;
    return (
      <Notice onClose={() => setDismissed('android')}>
        <span>새 안드로이드 앱이 나왔습니다. 받아서 설치하면 이 앱 위에 덮어 설치됩니다.</span>
        <button
          type="button"
          className="button button--primary"
          onClick={() =>
            void loadAndroid().then((android) => android.openExternal(ANDROID_DOWNLOAD_URL))
          }
        >
          새 앱 받기
        </button>
      </Notice>
    );
  }
  if (!desktop) return null;

  if (!updates) {
    if (dismissed === 'legacy') return null;
    return (
      <Notice onClose={() => setDismissed('legacy')}>
        <span>
          자동 업데이트가 되지 않는 옛 버전 앱입니다. 새 버전을 한 번 설치하면 그 뒤로는 알아서
          업데이트됩니다.
        </span>
        <a
          className="button button--primary"
          href={DESKTOP_DOWNLOAD_URL}
          target="_blank"
          rel="noreferrer"
        >
          새 버전 받기
        </a>
      </Notice>
    );
  }

  // 닫은 뒤에 더 새 버전을 받으면 다시 띄운다.
  if (!ready || dismissed === ready.version) return null;
  // 스스로 설치할 수 없는 앱(서명하지 않은 macOS, deb로 설치한 Linux)은 설치 파일 받는 곳을 연다.
  if (ready.manual) {
    return (
      <Notice onClose={() => setDismissed(ready.version)}>
        <span>새 버전({ready.version})이 나왔습니다. 설치 파일을 받아 설치해 주세요.</span>
        <a
          className="button button--primary"
          href={DESKTOP_DOWNLOAD_URL}
          target="_blank"
          rel="noreferrer"
        >
          새 버전 받기
        </a>
      </Notice>
    );
  }
  return (
    <Notice onClose={() => setDismissed(ready.version)}>
      <span>새 버전({ready.version})이 준비됐습니다. 다시 시작하면 적용됩니다.</span>
      <button
        type="button"
        className="button button--primary"
        onClick={() => void updates.install()}
      >
        다시 시작
      </button>
    </Notice>
  );
}

function Notice({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="update-notice" role="status">
      {children}
      <button
        type="button"
        className="icon-button"
        onClick={onClose}
        aria-label="닫기"
        title="닫기"
      >
        <X aria-hidden />
      </button>
    </div>
  );
}
