import { type KeyboardEvent, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** 펼친 목록이 있는 Select 수 (에디터의 단축키가 목록을 고르는 키를 가로채지 않게) */
let openCount = 0;

/** 펼쳐진 Select 목록이 있는지. 에디터의 키 처리(Esc로 닫기, 방향키 등)는 이때 아무것도 하지 않는다 */
export function isSelectOpen(): boolean {
  return openCount > 0;
}

/** 목록이 아래에 들어가지 않으면 위로 펼친다. 이 높이를 넘으면 목록 안에서 스크롤한다 */
const LIST_MAX_HEIGHT = 280;

/**
 * 앱 안에서 그리는 고르기 칸 (브라우저 기본 select 대신). 에디터·애니메이터에서 기본 select가 가끔 열리지
 * 않거나 고른 값이 먹지 않는 일이 있어서, 우클릭 메뉴처럼 앱이 직접 목록을 그린다.
 * 키보드: 닫혀 있을 때 ↑↓로 바로 바꾸고, Enter·Space·Alt+↓로 펼친다. 펼쳤을 때 ↑↓·Home·End로 옮기고
 * Enter로 고르며 Esc·Tab으로 닫는다.
 */
export function Select({
  value,
  options,
  onChange,
  disabled,
  className,
  'aria-label': ariaLabel,
  title,
}: {
  value: string;
  options: readonly SelectOption[];
  onChange(value: string): void;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<{
    left: number;
    top: number;
    width: number;
    up: boolean;
    viewHeight: number;
  }>();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = options[selectedIndex];

  const enabledFrom = (start: number, step: 1 | -1): number => {
    for (let i = start; i >= 0 && i < options.length; i += step) {
      if (!options[i]!.disabled) return i;
    }
    return -1;
  };

  const show = () => {
    if (disabled || options.length === 0) return;
    setActive(selectedIndex >= 0 ? selectedIndex : Math.max(0, enabledFrom(0, 1)));
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus({ preventScroll: true });
  };
  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    close();
    if (option.value !== value) onChange(option.value);
  };

  // 펼친 동안 세어 둔다 (에디터 단축키가 비켜 가게)
  useEffect(() => {
    if (!open) return;
    openCount++;
    return () => {
      openCount--;
    };
  }, [open]);

  // 목록 자리: 버튼 바로 아래 (모자라면 위). 화면에 고정해 그려서 스크롤되는 칸 안에서도 잘리지 않는다.
  useLayoutEffect(() => {
    if (!open) return;
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom;
    const up = below < Math.min(LIST_MAX_HEIGHT, options.length * 32 + 12) && rect.top > below;
    setPlace({
      left: rect.left,
      top: up ? rect.top : rect.bottom,
      width: rect.width,
      up,
      viewHeight: window.innerHeight,
    });
  }, [open, options.length]);

  // 고른 칸이 보이게
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, active, place]);

  // 바깥을 누르거나 창 크기가 바뀌거나 바깥이 스크롤되면 닫는다.
  useEffect(() => {
    if (!open) return;
    const inside = (target: EventTarget | null) =>
      target instanceof Node &&
      (!!buttonRef.current?.contains(target) || !!listRef.current?.contains(target));
    const onDown = (e: PointerEvent) => {
      if (!inside(e.target)) close(false);
    };
    const onScroll = (e: Event) => {
      if (!inside(e.target)) close(false);
    };
    const onResize = () => close(false);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('blur', onResize);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('blur', onResize);
    };
  }, [open]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const key = e.key;
    if (!open) {
      if (key === 'Enter' || key === ' ' || (key === 'ArrowDown' && e.altKey)) {
        e.preventDefault();
        show();
      } else if (key === 'ArrowDown' || key === 'ArrowUp') {
        // 기본 select처럼 닫힌 채로 바로 바꾼다
        e.preventDefault();
        const next =
          key === 'ArrowDown'
            ? enabledFrom(selectedIndex + 1, 1)
            : enabledFrom(selectedIndex < 0 ? options.length - 1 : selectedIndex - 1, -1);
        if (next >= 0) onChange(options[next]!.value);
      }
      return;
    }
    if (key === 'Escape') {
      // 아래의 창(에디터, 설정)까지 닫히지 않게 한다
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (key === 'Tab') {
      close(false);
    } else if (key === 'Enter' || key === ' ') {
      e.preventDefault();
      choose(active);
    } else if (key === 'ArrowDown' || key === 'ArrowUp') {
      e.preventDefault();
      const next = key === 'ArrowDown' ? enabledFrom(active + 1, 1) : enabledFrom(active - 1, -1);
      if (next >= 0) setActive(next);
    } else if (key === 'Home' || key === 'End') {
      e.preventDefault();
      const next = key === 'Home' ? enabledFrom(0, 1) : enabledFrom(options.length - 1, -1);
      if (next >= 0) setActive(next);
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        className={`select${className ? ` ${className}` : ''}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        title={title}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKeyDown}
      >
        <span className="select__value">{selected?.label ?? value}</span>
        <ChevronDown aria-hidden />
      </button>
      {open &&
        place &&
        createPortal(
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            className="select__list"
            aria-label={ariaLabel}
            style={{
              left: place.left,
              minWidth: place.width,
              maxHeight: LIST_MAX_HEIGHT,
              ...(place.up ? { bottom: place.viewHeight - place.top + 4 } : { top: place.top + 4 }),
            }}
          >
            {options.map((option, i) => (
              <li
                key={option.value}
                id={`${listId}-${i}`}
                role="option"
                data-index={i}
                aria-selected={i === selectedIndex}
                aria-disabled={option.disabled || undefined}
                data-active={i === active || undefined}
                onPointerMove={() => !option.disabled && setActive(i)}
                // 버튼에서 포커스가 빠지지 않게 (펼친 동안 키보드는 버튼이 받는다)
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => choose(i)}
              >
                {option.label}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  );
}
