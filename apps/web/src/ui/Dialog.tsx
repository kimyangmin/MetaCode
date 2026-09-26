import { type ReactNode, useEffect, useRef } from 'react';

interface DialogProps {
  title: string;
  onClose(): void;
  children: ReactNode;
}

/** 모달 창. 바깥을 누르거나 Esc를 누르면 닫힌다. */
export function Dialog({ title, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  // 부모가 다시 그려질 때마다 onClose가 새 함수여도 아래 effect가 다시 돌지 않도록 ref로 둔다.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
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
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header className="dialog__header">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
