import { type ReactNode, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface DialogProps {
  title: string;
  onClose(): void;
  children: ReactNode;
  /** 넓은 창 등 모양을 바꿀 때 */
  className?: string;
}

/** 모달 창. 바깥을 누르거나 Esc를 누르면 닫힌다. */
export function Dialog({ title, onClose, children, className }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  // 부모가 다시 그려질 때마다 onClose가 새 함수여도 아래 effect가 다시 돌지 않도록 ref로 둔다.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 위에 뜬 창(도트 에디터 등)이 먼저 Esc를 처리했으면(preventDefault) 닫지 않는다.
      if (e.key === 'Escape' && !e.defaultPrevented) onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 열릴 때 한 번만: 입력칸이 있으면 입력칸에, 없으면 본문의 첫 버튼에 초점을 둔다.
  // (닫기 버튼이 먼저 잡혀 Enter로 창이 닫히지 않도록)
  useEffect(() => {
    const first =
      ref.current?.querySelector<HTMLElement>('input, textarea') ??
      ref.current?.querySelector<HTMLElement>(
        '.dialog__header ~ * button, .dialog__header ~ button',
      );
    first?.focus();
  }, []);

  return (
    <div className="dialog__overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={className ? `dialog ${className}` : 'dialog'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <header className="dialog__header">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="닫기" title="닫기 (Esc)">
            <X aria-hidden />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
