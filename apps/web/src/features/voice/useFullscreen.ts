import { type RefObject, useEffect, useState } from 'react';

/**
 * 화면 공유 영상의 전체 화면.
 * - 'native': 브라우저 전체 화면 (requestFullscreen)
 * - 'window': 브라우저가 거절했을 때 창 안을 꽉 채운다. 데스크톱 0.4.0 이하 앱은 전체 화면 권한을
 *   주지 않아 requestFullscreen이 늘 거절되었다 (0.4.1부터 허락). Esc로 끝낸다.
 * 요소는 분리한 창(다른 document)에 있을 수도 있으므로 그 요소의 document와 window를 쓴다.
 */
export type FullscreenMode = 'off' | 'native' | 'window';

export function useFullscreen(ref: RefObject<HTMLElement | null>) {
  const [mode, setMode] = useState<FullscreenMode>('off');

  // 브라우저 전체 화면이 끝나면(Esc, F11 등) 상태를 맞춘다. 요소가 바뀔 수 있어(분리/되돌리기) 매번 건다.
  useEffect(() => {
    const doc = ref.current?.ownerDocument;
    if (!doc) return;
    const onChange = () => {
      if (!doc.fullscreenElement) setMode((current) => (current === 'native' ? 'off' : current));
    };
    doc.addEventListener('fullscreenchange', onChange);
    return () => doc.removeEventListener('fullscreenchange', onChange);
  });

  // 창 채우기는 Esc로 끝낸다. 보기 창의 Esc(닫기)보다 먼저 받아서 막는다 (defaultPrevented).
  useEffect(() => {
    if (mode !== 'window') return;
    const win = ref.current?.ownerDocument.defaultView;
    if (!win) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setMode('off');
    };
    win.addEventListener('keydown', onKey, true);
    return () => win.removeEventListener('keydown', onKey, true);
  }, [mode, ref]);

  const exit = () => {
    const doc = ref.current?.ownerDocument;
    if (doc?.fullscreenElement) void doc.exitFullscreen().catch(() => {});
    setMode('off');
  };

  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (mode !== 'off') {
      exit();
      return;
    }
    if (!el.requestFullscreen) {
      setMode('window');
      return;
    }
    el.requestFullscreen().then(
      () => setMode('native'),
      () => setMode('window'),
    );
  };

  return { mode, toggle, exit };
}
