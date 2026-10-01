import { useEffect, useState } from 'react';

export interface PopupWindow {
  window: Window;
  /** React로 그릴 자리 (createPortal로 그린다) */
  container: HTMLElement;
}

/**
 * 빈 새 창을 연다. 팝업 차단을 피하려고 버튼을 누른 처리 안에서 바로 부른다.
 * 같은 출처의 빈 창이라 이 창의 객체(화면 공유 MediaStream 등)를 그대로 넘겨 쓸 수 있다.
 * 앱 화면의 스타일시트를 복사해 넣는다. 열 수 없으면(팝업 차단, 이전 데스크톱 앱) null
 */
export function openPopupWindow(options: {
  name: string;
  title: string;
  width: number;
  height: number;
}): PopupWindow | null {
  const { name, title, width, height } = options;
  const popup = window.open(
    '',
    name,
    `popup,width=${Math.round(width)},height=${Math.round(height)}`,
  );
  if (!popup) return null;
  const doc = popup.document;
  doc.title = title;
  for (const node of document.querySelectorAll<HTMLElement>('link[rel="stylesheet"], style')) {
    const copy = node.cloneNode(true) as HTMLElement;
    // 빈 창의 주소는 about:blank라 상대 경로가 어긋날 수 있어 절대 주소로 바꾼다.
    if (copy instanceof HTMLLinkElement && node instanceof HTMLLinkElement) copy.href = node.href;
    doc.head.append(copy);
  }
  // 라이트/다크도 메인 창을 따른다 (설정에서 바꾸면 이 창도 바뀜).
  const syncTheme = () => {
    if (popup.closed) observer.disconnect();
    else doc.documentElement.dataset.theme = document.documentElement.dataset.theme;
  };
  const observer = new MutationObserver(syncTheme);
  observer.observe(document.documentElement, { attributeFilter: ['data-theme'] });
  syncTheme();
  doc.body.className = 'popup-window';
  const container = doc.createElement('div');
  container.className = 'popup-window__root';
  doc.body.replaceChildren(container);
  return { window: popup, container };
}

/**
 * 연 새 창을 들고 있는다. 사용자가 창을 닫으면 onClosed를 부르고, 이 컴포넌트가 사라지면 창을 닫는다.
 */
export function usePopupWindow(onClosed: () => void) {
  const [popup, setPopup] = useState<PopupWindow | null>(null);

  useEffect(() => {
    if (!popup) return;
    // 다른 창의 unload 이벤트는 믿기 어려워서 닫혔는지 주기적으로 본다.
    const timer = setInterval(() => {
      if (!popup.window.closed) return;
      setPopup(null);
      onClosed();
    }, 500);
    return () => {
      clearInterval(timer);
      if (!popup.window.closed) popup.window.close();
    };
    // 창이 바뀔 때만 다시 건다 (콜백이 바뀔 때마다 다시 걸지 않는다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popup]);

  return [popup, setPopup] as const;
}
