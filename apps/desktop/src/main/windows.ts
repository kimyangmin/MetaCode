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
