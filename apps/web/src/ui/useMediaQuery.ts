import { useSyncExternalStore } from 'react';

/** 휴대폰 화면: 커뮤니티 목록·채널 목록을 서랍으로 접고, 채팅과 광장을 하나씩 보여 준다 */
export const PHONE_QUERY = '(max-width: 768px)';
/** 좁은 화면: 오른쪽 멤버 목록을 자리 대신 위에 겹쳐 띄운다 */
export const NARROW_QUERY = '(max-width: 1000px)';

const matcher = (query: string) =>
  typeof window === 'undefined' || !window.matchMedia ? null : window.matchMedia(query);

/** CSS 미디어 쿼리가 지금 맞는지. 창 크기가 바뀌면 다시 그린다 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = matcher(query);
      list?.addEventListener('change', onChange);
      return () => list?.removeEventListener('change', onChange);
    },
    () => matcher(query)?.matches ?? false,
  );
}

export const useIsPhone = () => useMediaQuery(PHONE_QUERY);

/** 손가락으로 쓰는 기기인지 (휴대폰, 태블릿). 이런 기기에서는 Enter가 줄 바꾸기다 */
export const isTouchDevice = (): boolean => matcher('(pointer: coarse)')?.matches ?? false;
