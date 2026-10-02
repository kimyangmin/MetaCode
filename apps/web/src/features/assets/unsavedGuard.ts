import { type RefObject, useEffect } from 'react';
import { isDesktop } from '../../platform';

/**
 * 저장하지 않은 변경이 있는데 창을 닫거나 새로 고치면 브라우저가 한 번 묻게 한다 (에디터를 새 창으로 띄우면
 * 창의 닫기 단추로 바로 닫을 수 있어서). discarding이 참이면(에디터의 닫기에서 이미 확인받음) 묻지 않는다.
 * 데스크톱 앱(Electron)은 beforeunload로 막으면 묻지 않고 창이 닫히지 않기만 해서 걸지 않는다.
 */
export function useUnsavedGuard(editor: { dirty: boolean }, discarding: RefObject<boolean>): void {
  useEffect(() => {
    if (isDesktop()) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (editor.dirty && !discarding.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [editor, discarding]);
}
