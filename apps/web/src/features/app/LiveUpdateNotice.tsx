import { useState } from 'react';
import { useLiveUpdate } from './liveUpdate';
import { X } from 'lucide-react';

/**
 * 새로 배포된 웹이 있는데 바로 새로 불러올 수 없을 때(통화 중, 쓰던 글이나 편집 중인 에셋이 있음) 띄운다.
 * 그 상태가 풀리면 알아서 새로 불러오므로, 누르지 않아도 된다.
 */
export function LiveUpdateNotice() {
  const { available, reloadNow } = useLiveUpdate();
  const [dismissed, setDismissed] = useState(false);
  if (!available || dismissed) return null;
  return (
    <div className="update-notice" role="status">
      <span>새 버전이 나왔습니다. 통화나 편집이 끝나면 자동으로 적용됩니다.</span>
      <button type="button" className="button button--primary" onClick={reloadNow}>
        지금 적용
      </button>
      <button
        type="button"
        className="icon-button"
        onClick={() => setDismissed(true)}
        aria-label="닫기"
      >
        <X aria-hidden />
      </button>
    </div>
  );
}
