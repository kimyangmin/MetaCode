import { type ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface LightboxProps {
  src: string;
  alt: string;
  /** 그림 아래 막대 (설명, 버튼) */
  children?: ReactNode;
  /** `.lightbox--<variant>`로 그림 크기 등을 바꾼다 */
  variant?: 'avatar';
  onClose(): void;
}

/**
 * 이미지를 크게 보기. Esc나 바깥을 누르면 닫힌다.
 * body에 포털로 그린다: 여는 쪽(정보 팝업 등)이 transform 애니메이션을 쓰면 fixed가 그 안에 갇히므로.
 * Esc는 캡처 단계에서 먼저 받아 preventDefault()하므로 아래에 깔린 창은 닫히지 않는다.
 */
export function Lightbox({ src, alt, children, variant, onClose }: LightboxProps) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return createPortal(
    <div
      className={variant ? `lightbox lightbox--${variant}` : 'lightbox'}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onMouseDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <img src={src} alt={alt} />
      {children && <div className="lightbox__bar">{children}</div>}
    </div>,
    document.body,
  );
}
