/**
 * 앱 화면이 새 창으로 열려는 주소가 "분리한 창"(채팅·광장 하나만 보여 주는 앱 화면)인지.
 * 앱과 같은 출처이고 경로(또는 해시 경로)가 /popout/으로 시작할 때만 앱 창으로 연다.
 * 그 밖의 http(s) 주소는 시스템 브라우저로, 나머지는 막는다.
 */
export function isPopoutUrl(url: string, appOrigin: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== appOrigin) return false;
    return parsed.pathname.startsWith('/popout/') || parsed.hash.startsWith('#/popout/');
  } catch {
    return false;
  }
}

/** 화면 공유 보기를 떼어 낸 창의 이름 (웹의 openPopupWindow와 같은 이름) */
export const SCREEN_POPUP_NAME = 'metacode-screen';

/**
 * 화면 공유 보기를 떼어 낸 빈 창인지. 웹이 같은 출처의 빈 창(about:blank)을 열고 그 안에
 * 영상을 그린다 (통화 연결은 메인 창에 그대로 두고 영상만 넘겨주려고). 이름이 맞을 때만 연다.
 */
export function isScreenPopup(url: string, frameName: string): boolean {
  return url === 'about:blank' && frameName === SCREEN_POPUP_NAME;
}
