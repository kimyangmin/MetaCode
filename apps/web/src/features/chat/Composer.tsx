import { MESSAGE_MAX_LENGTH } from '@metacode/shared';
import { type KeyboardEvent, useLayoutEffect, useRef, useState } from 'react';

const MAX_HEIGHT_PX = 200;

interface ComposerProps {
  placeholder: string;
  onSend(content: string): void;
  onTyping(): void;
}

/**
 * 메시지 입력창. Enter로 보내고 Shift+Enter로 줄을 바꾼다.
 * 한글 입력 중(IME 조합 중)의 Enter는 글자 확정이므로 보내지 않는다.
 */
export function Composer({ placeholder, onSend, onTyping }: ComposerProps) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  // 내용에 맞춰 높이를 늘리되 너무 커지지 않게 한다.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [value]);

  const submit = () => {
    const content = value.trim();
    if (!content) return;
    onSend(content);
    setValue('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    submit();
  };

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={ref}
        className="composer__input"
        value={value}
        placeholder={placeholder}
        rows={1}
        maxLength={MESSAGE_MAX_LENGTH}
        onChange={(e) => {
          setValue(e.target.value);
          if (e.target.value.trim()) onTyping();
        }}
        onKeyDown={onKeyDown}
        aria-label={placeholder}
      />
    </form>
  );
}
