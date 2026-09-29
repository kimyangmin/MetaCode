import { useEffect, useState } from 'react';

/**
 * 닫힐 때 사라지는 애니메이션을 보여 주려고, 값이 null이 된 뒤에도 ms 동안 마지막 값을 남겨 둔다.
 * closing인 동안 CSS로 사라지는 모습을 그리고, 시간이 지나면 shown이 null이 되어 내린다.
 * (animationend 대신 시간을 쓰는 이유: 움직임 줄이기 설정으로 애니메이션을 끄면 이벤트가 오지 않는다)
 */
export function useExitTransition<T>(
  value: T | null,
  ms: number,
): { shown: T | null; closing: boolean } {
  const [shown, setShown] = useState(value);
  const [closing, setClosing] = useState(false);

  // 이전 렌더의 값과 비교해 바로 맞춘다 (effect로 맞추면 한 번 빈 화면이 그려진다).
  if (value !== null && (value !== shown || closing)) {
    setShown(value);
    setClosing(false);
  } else if (value === null && shown !== null && !closing) {
    setClosing(true);
  }

  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => {
      setShown(null);
      setClosing(false);
    }, ms);
    return () => clearTimeout(timer);
  }, [closing, ms]);

  return { shown, closing };
}
