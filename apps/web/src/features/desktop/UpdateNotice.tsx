import type { UpdateReadyInfo } from '@metacode/shared';
import { type ReactNode, useEffect, useState } from 'react';
import { DESKTOP_DOWNLOAD_URL } from '../../config';
import { getDesktopBridge } from '../../platform';

/**
 * 데스크톱 앱 업데이트 안내. 메인 프로세스가 새 버전을 다 받아 두면 "다시 시작"을 띄운다
 * (누르지 않아도 앱을 끌 때 설치된다). 자동 업데이트가 없는 옛 앱(0.2.0 이하)에는 설치 파일 받는 곳을 알려 준다.
 * 브라우저에서는 아무것도 그리지 않는다.
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
        ×
      </button>
    </div>
  );
}
