import type { MessageDto } from '@metacode/shared';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { copyText } from '../../ui/clipboard';
import { Copy, Forward, Link as LinkIcon, Pencil, Reply, Trash2 } from 'lucide-react';

export interface MenuTarget {
  message: MessageDto;
  x: number;
  y: number;
  /** 링크 위에서 눌렀으면 그 주소 */
  link: string | null;
}

interface MessageMenuProps {
  target: MenuTarget;
  /** 내가 보낸 메시지면 수정을 보인다 */
  mine: boolean;
  /** 삭제를 보일지 (내 메시지, 또는 커뮤니티 소유자·관리자면 남의 메시지도) */
  canDelete: boolean;
  onReply(message: MessageDto): void;
  onForward(message: MessageDto): void;
  onEdit(message: MessageDto): void;
  onDelete(message: MessageDto): void;
  onClose(): void;
}

const MARGIN = 8;

/**
 * 메시지 우클릭 메뉴: 답장, 전달, 텍스트 복사, (링크 위면) 링크 복사, (내 메시지면) 수정,
 * (내 메시지 또는 관리자면) 삭제
 */
export function MessageMenu({
  target,
  mine,
  canDelete,
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
    el.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
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
    // 목록을 스크롤하면 메뉴가 엉뚱한 곳에 남지 않게 닫는다. 휠뿐 아니라 손가락·스크롤바·키보드로
    // 스크롤해도 닫히도록 어느 요소의 scroll이든 캡처 단계에서 받는다 (scroll은 버블되지 않음).
    window.addEventListener('wheel', close, { passive: true });
    window.addEventListener('scroll', close, { capture: true, passive: true });
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('wheel', close);
      window.removeEventListener('scroll', close, { capture: true });
    };
  }, [onClose]);

  const run = (action: () => void) => () => {
    action();
    onClose();
  };
  const copy = (text: string) => void copyText(text).catch(() => {});

  return (
    <div ref={ref} className="menu context-menu" role="menu" style={position}>
      <button role="menuitem" onClick={run(() => onReply(target.message))}>
        <Reply aria-hidden /> 답장
      </button>
      <button role="menuitem" onClick={run(() => onForward(target.message))}>
        <Forward aria-hidden /> 전달
      </button>
      {target.message.content && (
        <button role="menuitem" onClick={run(() => copy(target.message.content))}>
          <Copy aria-hidden /> 텍스트 복사
        </button>
      )}
      {target.link && (
        <button role="menuitem" onClick={run(() => copy(target.link!))}>
          <LinkIcon aria-hidden /> 링크 복사
        </button>
      )}
      {mine && (
        <button role="menuitem" onClick={run(() => onEdit(target.message))}>
          <Pencil aria-hidden /> 수정
        </button>
      )}
      {canDelete && (
        <button
          role="menuitem"
          className="menu__danger"
          onClick={run(() => onDelete(target.message))}
        >
          <Trash2 aria-hidden /> 삭제
        </button>
      )}
    </div>
  );
}
