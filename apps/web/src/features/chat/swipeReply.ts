import { type RefObject, useEffect, useRef } from 'react';
import { TEXT_INPUT_SELECTOR, gestureAxis, inHorizontalScroller } from '../../ui/swipe';

/** 메시지를 이만큼 넘게 왼쪽으로 밀었다 놓으면 답장한다 (px) */
export const REPLY_DISTANCE = 56;
/** 메시지가 손가락을 따라 나오는 최대 거리 (px) */
const MAX_PULL = 96;
/** 놓은 뒤 제자리로 돌아가는 시간 (styles.css의 .message[data-swipe='release']와 같게) */
const RELEASE_MS = 180;

/**
 * 민 거리 → 메시지가 옮겨 그려지는 거리. 답장 거리까지는 손가락을 그대로 따라오고,
 * 그 뒤로는 덜 따라오다 MAX_PULL에서 멈춘다. 왼쪽으로 밀므로 0 이하이고, 오른쪽으로 민 것은 0이다.
 */
export function replyPull(dx: number): number {
  const distance = -dx;
  if (distance <= 0) return 0;
  if (distance <= REPLY_DISTANCE) return -distance;
  return -Math.min(MAX_PULL, REPLY_DISTANCE + (distance - REPLY_DISTANCE) * 0.35);
}

export const shouldReply = (dx: number): boolean => -dx >= REPLY_DISTANCE;

/**
 * 손가락으로 메시지를 왼쪽으로 밀어 답장하기 (휴대폰, 태블릿).
 * 미는 동안 메시지가 손가락을 따라오고 오른쪽에 답장 표시가 나온다(.message의 data-swipe, --swipe-x,
 * --swipe-progress, data-swipe-ready). 세로로 움직이면 목록 스크롤로 보고 그만 본다.
 * 오른쪽으로 밀기는 목록 서랍 열기(layout/drawerSwipe.ts)라서, 처음 오른쪽으로 움직였으면 그만 본다.
 */
export function useSwipeToReply(
  listRef: RefObject<HTMLElement | null>,
  onReply: (messageId: string) => void,
): void {
  const onReplyRef = useRef(onReply);
  useEffect(() => {
    onReplyRef.current = onReply;
  });

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    let gesture: { el: HTMLElement; x: number; y: number; axis: 'x' | 'y' | null } | null = null;

    const release = () => {
      if (!gesture) return;
      const { el } = gesture;
      gesture = null;
      if (!el.dataset.swipe) return;
      el.dataset.swipe = 'release';
      el.style.setProperty('--swipe-x', '0px');
      el.style.setProperty('--swipe-progress', '0');
      delete el.dataset.swipeReady;
      setTimeout(() => {
        if (el.dataset.swipe !== 'release') return;
        delete el.dataset.swipe;
        el.style.removeProperty('--swipe-x');
        el.style.removeProperty('--swipe-progress');
      }, RELEASE_MS);
    };

    const onStart = (e: TouchEvent) => {
      release();
      const touch = e.touches[0];
      const target = e.target as Element;
      if (!touch || e.touches.length > 1) return;
      // 채팅 영역 잡기 중에는 밀지 않는다.
      if (list.dataset.selecting === 'true') return;
      if (target.closest(TEXT_INPUT_SELECTOR) || inHorizontalScroller(target, list)) return;
      const el = target.closest<HTMLElement>('[data-message-id]');
      if (!el || !list.contains(el) || el.querySelector('.message__editor')) return;
      gesture = { el, x: touch.clientX, y: touch.clientY, axis: null };
    };

    const onMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!gesture || !touch) return;
      const dx = touch.clientX - gesture.x;
      gesture.axis ??= gestureAxis(dx, touch.clientY - gesture.y);
      if (gesture.axis === 'y') return release();
      if (gesture.axis !== 'x') return;
      const { el } = gesture;
      if (!el.dataset.swipe && dx > 0) return release();
      el.dataset.swipe = 'drag';
      el.style.setProperty('--swipe-x', `${replyPull(dx)}px`);
      el.style.setProperty(
        '--swipe-progress',
        String(Math.min(1, Math.max(0, -dx) / REPLY_DISTANCE)),
      );
      if (shouldReply(dx)) el.dataset.swipeReady = '';
      else delete el.dataset.swipeReady;
    };

    const onEnd = (e: TouchEvent) => {
      const touch = e.changedTouches[0];
      const id = gesture?.el.dataset.messageId;
      const replied = gesture?.axis === 'x' && touch && shouldReply(touch.clientX - gesture.x);
      release();
      if (replied && id) onReplyRef.current(id);
    };

    list.addEventListener('touchstart', onStart, { passive: true });
    list.addEventListener('touchmove', onMove, { passive: true });
    list.addEventListener('touchend', onEnd);
    list.addEventListener('touchcancel', release);
    return () => {
      list.removeEventListener('touchstart', onStart);
      list.removeEventListener('touchmove', onMove);
      list.removeEventListener('touchend', onEnd);
      list.removeEventListener('touchcancel', release);
    };
  }, [listRef]);
}
