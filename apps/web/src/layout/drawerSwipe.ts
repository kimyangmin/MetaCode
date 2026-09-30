import { type RefObject, useEffect } from 'react';
import { useUiStore } from '../stores/ui';
import { PHONE_QUERY } from '../ui/useMediaQuery';
import { TEXT_INPUT_SELECTOR, gestureAxis, inHorizontalScroller } from '../ui/swipe';

export type Drawer = 'nav' | 'members';

/** 이만큼 넘게 밀면 닫는다 (px) */
export const CLOSE_DISTANCE = 60;
/** 닫힌 목록 서랍을 이만큼 넘게 오른쪽으로 밀면 연다 (px) */
export const OPEN_DISTANCE = 60;

/**
 * 오른쪽으로 밀어도 목록 서랍을 열지 않는 곳: 글 입력칸, 메시지(밀면 답장, features/chat/swipeReply.ts),
 * 떠 있는 창, 분할 화면 구분선.
 */
const NO_OPEN_SELECTOR = [
  TEXT_INPUT_SELECTOR,
  '[data-message-id]',
  '[role="dialog"]',
  '.screen-viewer',
  '.split__separator',
].join(', ');

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

/**
 * 닫힌 목록 서랍을 여는 동안의 위치: 열린 자리 기준으로 왼쪽으로 얼마나 가 있는지 (-width ~ 0).
 * width는 커뮤니티 막대 + 채널 목록의 폭이다.
 */
export function openDragOffset(dx: number, width: number): number {
  return Math.min(0, Math.max(-width, dx - width));
}

export function shouldOpen(dx: number): boolean {
  return dx >= OPEN_DISTANCE;
}

/**
 * 좁은 화면의 서랍(왼쪽 커뮤니티·채널 목록, 오른쪽 멤버 목록)을 손가락으로 여닫기.
 * - 열린 서랍은 반대쪽으로 밀어 닫는다.
 * - 휴대폰 화면에서 닫혀 있으면 왼쪽에서 오른쪽으로 밀어 목록 서랍을 연다.
 * 미는 동안은 서랍이 손가락을 따라오고(.app의 --drawer-drag, --drawer-progress, data-dragging),
 * 충분히 밀면 열거나 닫는다.
 */
export function useDrawerSwipe(appRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const app = appRef.current;
    if (!app) return;
    let gesture: {
      drawer: Drawer;
      /** 닫힌 목록 서랍을 여는 중이면 서랍 폭, 열린 서랍을 닫는 중이면 null */
      opening: number | null;
      x: number;
      y: number;
      axis: 'x' | 'y' | null;
    } | null = null;

    const reset = () => {
      gesture = null;
      app.style.removeProperty('--drawer-drag');
      app.style.removeProperty('--drawer-progress');
      delete app.dataset.dragging;
    };

    /** 휴대폰 화면에서 닫힌 목록 서랍을 열 수 있는 곳을 눌렀으면 서랍 폭, 아니면 null */
    const openWidth = (target: Element): number | null => {
      if (!window.matchMedia?.(PHONE_QUERY).matches) return null;
      if (target.closest(NO_OPEN_SELECTOR) || inHorizontalScroller(target, app)) return null;
      if (document.querySelector('[aria-modal="true"]')) return null;
      const rail = app.querySelector<HTMLElement>('.rail');
      const sidebar = app.querySelector<HTMLElement>('.sidebar');
      if (!rail || !sidebar) return null;
      return rail.offsetWidth + sidebar.offsetWidth;
    };

    const onStart = (e: TouchEvent) => {
      const { navOpen, membersDrawerOpen } = useUiStore.getState();
      const target = e.target as Element;
      const touch = e.touches[0];
      if (!touch || e.touches.length > 1) return reset();
      const onBackdrop = !!target.closest('.app__backdrop');
      let drawer: Drawer | null = null;
      let opening: number | null = null;
      if (navOpen && (onBackdrop || target.closest('.rail, .sidebar'))) drawer = 'nav';
      else if (membersDrawerOpen && (onBackdrop || target.closest('.members-slot'))) {
        drawer = 'members';
      } else if (!navOpen && !membersDrawerOpen) {
        opening = openWidth(target);
        if (opening !== null) drawer = 'nav';
      }
      gesture = drawer && { drawer, opening, x: touch.clientX, y: touch.clientY, axis: null };
    };

    const onMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!gesture || !touch) return;
      const dx = touch.clientX - gesture.x;
      gesture.axis ??= gestureAxis(dx, touch.clientY - gesture.y);
      if (gesture.axis === 'y') return reset();
      if (gesture.axis !== 'x') return;
      // 여는 중에 왼쪽으로 먼저 민 것은 서랍과 상관없다 (메시지 목록 등 그대로)
      if (gesture.opening !== null && dx <= 0 && !app.dataset.dragging) return;
      const offset =
        gesture.opening !== null
          ? openDragOffset(dx, gesture.opening)
          : dragOffset(gesture.drawer, dx);
      const width = gesture.opening ?? drawerWidth(app, gesture.drawer);
      app.dataset.dragging = gesture.drawer;
      app.style.setProperty('--drawer-drag', `${offset}px`);
      app.style.setProperty(
        '--drawer-progress',
        String(width > 0 ? Math.max(0, 1 - Math.abs(offset) / width) : 1),
      );
    };

    const onEnd = (e: TouchEvent) => {
      const touch = e.changedTouches[0];
      if (gesture?.axis === 'x' && touch) {
        const dx = touch.clientX - gesture.x;
        if (gesture.opening !== null) {
          if (shouldOpen(dx)) useUiStore.getState().setNavOpen(true);
        } else if (shouldClose(gesture.drawer, dx)) {
          useUiStore.getState().closeDrawers();
        }
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

/** 열린 서랍의 폭 (배경을 얼마나 어둡게 둘지 계산용) */
function drawerWidth(app: HTMLElement, drawer: Drawer): number {
  if (drawer === 'members')
    return app.querySelector<HTMLElement>('.members-slot')?.offsetWidth ?? 0;
  const rail = app.querySelector<HTMLElement>('.rail')?.offsetWidth ?? 0;
  return rail + (app.querySelector<HTMLElement>('.sidebar')?.offsetWidth ?? 0);
}
