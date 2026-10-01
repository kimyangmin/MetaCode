import { type KeyboardEvent, type PointerEvent, type RefObject, useRef } from 'react';
import { useUiStore } from '../stores/ui';
import {
  MEMBERS_WIDTH_DEFAULT,
  MEMBERS_WIDTH_MAX,
  MEMBERS_WIDTH_MIN,
  MEMBERS_WIDTH_STEP,
  NAV_COLUMNS,
  clampMembersWidth,
} from './membersWidth';

const clamp = (width: number) => clampMembersWidth(width, window.innerWidth, NAV_COLUMNS);

/**
 * 멤버 목록 왼쪽 가장자리: 끌어서 폭을 바꾸고, 포커스가 있으면 ←→로, 두 번 누르면 기본 폭.
 * 끄는 동안은 상태를 바꾸지 않고 칸(slotRef)의 CSS 변수만 고친다 (채팅·광장까지 다시 그리지 않게).
 * 놓을 때 한 번 저장한다. 좁은 화면(서랍)에서는 CSS가 숨긴다.
 */
export function MembersResizer({ slotRef }: { slotRef: RefObject<HTMLDivElement | null> }) {
  const width = useUiStore((s) => s.membersWidth);
  const setWidth = useUiStore((s) => s.setMembersWidth);
  const drag = useRef<{ startX: number; startWidth: number; width: number } | null>(null);

  const show = (value: number) => slotRef.current?.style.setProperty('--members-w', `${value}px`);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startWidth: width, width };
    // 끄는 동안은 여닫는 애니메이션을 끄고, 어디서나 같은 커서에 글자가 골라지지 않게 한다.
    slotRef.current?.setAttribute('data-resizing', '');
    document.documentElement.setAttribute('data-col-resizing', '');
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    // 왼쪽 가장자리라서 왼쪽으로 끌면 넓어진다.
    state.width = clamp(state.startWidth - (e.clientX - state.startX));
    show(state.width);
  };

  const finish = () => {
    const state = drag.current;
    if (!state) return;
    drag.current = null;
    slotRef.current?.removeAttribute('data-resizing');
    document.documentElement.removeAttribute('data-col-resizing');
    setWidth(state.width);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const delta =
      e.key === 'ArrowLeft' ? MEMBERS_WIDTH_STEP : e.key === 'ArrowRight' ? -MEMBERS_WIDTH_STEP : 0;
    if (delta === 0) return;
    e.preventDefault();
    setWidth(clamp(width + delta));
  };

  return (
    <div
      className="members-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="멤버 목록 폭"
      aria-valuemin={MEMBERS_WIDTH_MIN}
      aria-valuemax={MEMBERS_WIDTH_MAX}
      aria-valuenow={width}
      tabIndex={0}
      title="끌어서 폭 바꾸기 (두 번 누르면 원래대로)"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onDoubleClick={() => setWidth(MEMBERS_WIDTH_DEFAULT)}
      onKeyDown={onKeyDown}
    />
  );
}
