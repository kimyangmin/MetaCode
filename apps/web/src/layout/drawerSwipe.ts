import { type RefObject, useEffect } from 'react';
import { useUiStore } from '../stores/ui';

export type Drawer = 'nav' | 'members';

/** 이만큼 넘게 밀면 닫는다 (px) */
export const CLOSE_DISTANCE = 60;
/** 이만큼 움직일 때까지는 가로로 미는지 세로로 스크롤하는지 정하지 않는다 */
const DECIDE_DISTANCE = 10;

/**
 * 서랍을 닫는 쪽으로 민 거리. 왼쪽 목록(nav)은 왼쪽으로, 멤버 목록은 오른쪽으로 밀어야 닫힌다.
 * 반대쪽으로 민 것은 0이다 (서랍이 더 열리지 않게).
 */
export function dragOffset(drawer: Drawer, dx: number): number {
  return drawer === 'nav' ? Math.min(0, dx) : Math.max(0, dx);
}

export function shouldClose(drawer: Drawer, dx: number): boolean {
  return Math.abs(dragOffset(drawer, dx)) >= CLOSE_DISTANCE;
}

/** 손가락이 처음 움직인 방향: 가로면 서랍 밀기, 세로면 목록 스크롤로 보고 그만 본다. 아직 모르면 null */
export function gestureAxis(dx: number, dy: number): 'x' | 'y' | null {
  if (Math.abs(dx) < DECIDE_DISTANCE && Math.abs(dy) < DECIDE_DISTANCE) return null;
  return Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
}

/**
 * 좁은 화면의 서랍(왼쪽 커뮤니티·채널 목록, 오른쪽 멤버 목록)을 반대쪽으로 밀어 닫기.
 * 미는 동안은 서랍이 손가락을 따라오고(.app의 --drawer-drag, data-dragging), 충분히 밀면 닫는다.
 */
export function useDrawerSwipe(appRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const app = appRef.current;
    if (!app) return;
    let gesture: { drawer: Drawer; x: number; y: number; axis: 'x' | 'y' | null } | null = null;

    const reset = () => {
      gesture = null;
      app.style.removeProperty('--drawer-drag');
      delete app.dataset.dragging;
    };

    const onStart = (e: TouchEvent) => {
      const { navOpen, membersDrawerOpen } = useUiStore.getState();
      const target = e.target as Element;
      const touch = e.touches[0];
      if (!touch || e.touches.length > 1) return reset();
      const onBackdrop = !!target.closest('.app__backdrop');
      let drawer: Drawer | null = null;
      if (navOpen && (onBackdrop || target.closest('.rail, .sidebar'))) drawer = 'nav';
      else if (membersDrawerOpen && (onBackdrop || target.closest('.members-slot'))) {
        drawer = 'members';
      }
      gesture = drawer && { drawer, x: touch.clientX, y: touch.clientY, axis: null };
    };

    const onMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!gesture || !touch) return;
      const dx = touch.clientX - gesture.x;
      gesture.axis ??= gestureAxis(dx, touch.clientY - gesture.y);
      if (gesture.axis === 'y') return reset();
      if (gesture.axis !== 'x') return;
      app.dataset.dragging = gesture.drawer;
      app.style.setProperty('--drawer-drag', `${dragOffset(gesture.drawer, dx)}px`);
    };

    const onEnd = (e: TouchEvent) => {
      const touch = e.changedTouches[0];
      if (
        gesture?.axis === 'x' &&
        touch &&
        shouldClose(gesture.drawer, touch.clientX - gesture.x)
      ) {
        useUiStore.getState().closeDrawers();
      }
      reset();
    };

    app.addEventListener('touchstart', onStart, { passive: true });
    app.addEventListener('touchmove', onMove, { passive: true });
    app.addEventListener('touchend', onEnd);
    app.addEventListener('touchcancel', reset);
    return () => {
      app.removeEventListener('touchstart', onStart);
      app.removeEventListener('touchmove', onMove);
      app.removeEventListener('touchend', onEnd);
      app.removeEventListener('touchcancel', reset);
    };
  }, [appRef]);
}
