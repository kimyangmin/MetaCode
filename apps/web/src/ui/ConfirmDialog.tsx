import { type ReactNode, useEffect, useRef } from 'react';

interface ConfirmDialogProps {
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  /** 되돌릴 수 없는 일(로그아웃, 삭제)이면 확인 버튼을 빨갛게 */
  danger?: boolean;
  onConfirm(): void;
  onCancel(): void;
}

/**
 * 한 번 더 묻는 작은 창. 바깥을 누르거나 Esc면 취소한다.
 * Esc는 캡처 단계에서 먼저 받아 preventDefault()하므로, 아래에 깔린 창(설정 창 등)은 닫히지 않는다.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onCancelRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <div
      className="confirm__overlay"
      onMouseDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="confirm" role="alertdialog" aria-modal="true" aria-label={title}>
        <h2 className="confirm__title">{title}</h2>
        {children && <div className="confirm__body">{children}</div>}
        <div className="confirm__actions">
          <button type="button" className="button" onClick={onCancel}>
            취소
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={danger ? 'button button--danger' : 'button button--primary'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
