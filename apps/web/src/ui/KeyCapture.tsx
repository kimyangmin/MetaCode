import { inputKeyFromCode, inputKeyLabel } from '@metacode/shared';
import { useEffect, useRef, useState } from 'react';
import { claimKeyboard } from './keyboardClaim';

/**
 * 광장에서 누를 키를 정하는 칸: 누르고 나서 원하는 키를 직접 누르면 그 키가 달린다 (정해 둔 목록 없음).
 * Esc는 그만두기, Backspace는 키 지우기(allowNone일 때). 광장이 쓰는 키(방향키, 스페이스, / 등)와
 * Ctrl·Alt 조합, 이미 다른 모션·파라미터가 쓰는 키는 받지 않고 이유를 보여 준다.
 */
export function KeyCapture({
  value,
  onChange,
  taken,
  allowNone = true,
  'aria-label': ariaLabel,
}: {
  value: string | undefined;
  onChange(key: string | undefined): void;
  /** 그 키를 이미 다른 곳이 쓰면 true (지금 값은 빼고 센다) */
  taken(key: string): boolean;
  allowNone?: boolean;
  'aria-label'?: string;
}) {
  const [capturing, setCapturing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // 리스너는 받기 시작할 때 한 번만 걸고, 바뀌는 값은 ref로 읽는다
  const live = useRef({ value, onChange, taken, allowNone });
  useEffect(() => {
    live.current = { value, onChange, taken, allowNone };
  });

  useEffect(() => {
    if (!capturing) return;
    const release = claimKeyboard();
    const stop = () => setCapturing(false);
    const onKey = (e: KeyboardEvent) => {
      // 에디터 단축키·설정 창이 이 키를 받지 않게 한다
      e.preventDefault();
      e.stopPropagation();
      const { value: current, onChange: change, taken: isTaken, allowNone: none } = live.current;
      if (e.key === 'Escape') return stop();
      if (e.code === 'Backspace' && none) {
        change(undefined);
        setNotice(null);
        return stop();
      }
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      if (e.ctrlKey || e.altKey || e.metaKey) {
        setNotice('Ctrl·Alt를 함께 누른 키는 달 수 없습니다. 키 하나만 누르세요.');
        return;
      }
      const key = inputKeyFromCode(e.code);
      if (!key) {
        setNotice(
          `${e.code}은(는) 광장에서 쓰는 키라 달 수 없습니다 (방향키, 스페이스, /, Enter 등).`,
        );
        return;
      }
      if (key !== current && isTaken(key)) {
        setNotice(`${inputKeyLabel(key)} 키는 이미 다른 모션이나 파라미터가 씁니다.`);
        return;
      }
      setNotice(null);
      if (key !== current) change(key);
      stop();
    };
    const onDown = (e: PointerEvent) => {
      if (!buttonRef.current?.contains(e.target as Node)) stop();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('blur', stop);
    return () => {
      release();
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('blur', stop);
    };
  }, [capturing]);

  return (
    <span className="key-capture">
      <button
        ref={buttonRef}
        type="button"
        className="key-capture__button"
        aria-label={ariaLabel}
        aria-pressed={capturing}
        title="누른 뒤 광장에서 쓸 키를 누르세요 (Esc 그만두기 · Backspace 지우기)"
        onClick={() => {
          setNotice(null);
          setCapturing((v) => !v);
        }}
      >
        {capturing ? (
          '키를 누르세요…'
        ) : value ? (
          <>
            <kbd>{inputKeyLabel(value)}</kbd> 키
          </>
        ) : (
          '키 없음'
        )}
      </button>
      {notice && (
        <small className="key-capture__notice" role="alert">
          {notice}
        </small>
      )}
    </span>
  );
}
