import type { MessageDto } from '@metacode/shared';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface MenuTarget {
  message: MessageDto;
  x: number;
  y: number;
  /** 링크 위에서 눌렀으면 그 주소 */
  link: string | null;
}

interface MessageMenuProps {
  target: MenuTarget;
  /** 내가 보낸 메시지면 수정·삭제를 보인다 */
  mine: boolean;
  onReply(message: MessageDto): void;
  onForward(message: MessageDto): void;
  onEdit(message: MessageDto): void;
  onDelete(message: MessageDto): void;
  onClose(): void;
}

const MARGIN = 8;

/** 메시지 우클릭 메뉴: 답장, 전달, 텍스트 복사, (링크 위면) 링크 복사, (내 메시지면) 수정·삭제 */
export function MessageMenu({
  target,
  mine,
  onReply,
  onForward,
  onEdit,
  onDelete,
  onClose,
}: MessageMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: target.x, top: target.y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPosition({
      left: Math.max(MARGIN, Math.min(target.x, window.innerWidth - width - MARGIN)),
      top: Math.max(MARGIN, Math.min(target.y, window.innerHeight - height - MARGIN)),
    });
    el.querySelector<HTMLButtonElement>('button')?.focus();
  }, [target]);

  useEffect(() => {
    const close = () => onClose();
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    // 목록을 스크롤하면 메뉴가 엉뚱한 곳에 남지 않게 닫는다.
    window.addEventListener('wheel', close, { passive: true });
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('wheel', close);
    };
  }, [onClose]);

  const run = (action: () => void) => () => {
    action();
    onClose();
  };
  const copy = (text: string) => void navigator.clipboard.writeText(text).catch(() => {});

  return (
    <div ref={ref} className="menu context-menu" role="menu" style={position}>
      <button role="menuitem" onClick={run(() => onReply(target.message))}>
        ↩ 답장
      </button>
      <button role="menuitem" onClick={run(() => onForward(target.message))}>
        ↪ 전달
      </button>
      {target.message.content && (
        <button role="menuitem" onClick={run(() => copy(target.message.content))}>
          📋 텍스트 복사
        </button>
      )}
      {target.link && (
        <button role="menuitem" onClick={run(() => copy(target.link!))}>
          🔗 링크 복사
        </button>
      )}
      {mine && (
        <button role="menuitem" onClick={run(() => onEdit(target.message))}>
          ✏️ 수정
        </button>
      )}
      {mine && (
        <button
          role="menuitem"
          className="menu__danger"
          onClick={run(() => onDelete(target.message))}
        >
          🗑️ 삭제
        </button>
      )}
    </div>
  );
}
