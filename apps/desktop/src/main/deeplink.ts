/**
 * metacode:// 주소로 앱 열기. 웹의 초대 화면이 "앱에서 열기"로 metacode://invite/<코드>를 열면
 * OS가 설치한 앱을 켜고(또는 이미 켜진 앱에 넘기고), 앱은 그 초대 화면으로 간다.
 * 받을 수 있는 주소는 초대 하나뿐이고, 그 밖의 주소는 무시한다 (앱 화면을 임의 경로로 보내지 않게).
 */
export const PROTOCOL = 'metacode';

/**
 * 받는 주소: metacode://invite/<코드>. 코드 형식은 서버의 초대 코드 검사와 같다.
 * URL로 풀지 않고 원래 글자 그대로 맞춘다 (URL은 ../ 같은 경로를 풀어서 다른 주소가 통과할 수 있다).
 */
const INVITE_LINK = /^metacode:\/\/invite\/([A-Za-z0-9]{4,32})\/?$/i;

/** metacode:// 주소 → 앱 화면의 경로 (#/ 뒤). 받을 수 없는 주소면 null */
export function deepLinkRoute(url: string): string | null {
  const code = INVITE_LINK.exec(url.trim())?.[1];
  return code ? `/invite/${code}` : null;
}

/** 실행 인자(Windows·Linux는 주소가 인자로 온다)에서 앱 화면 경로를 찾는다 */
export function routeFromArgv(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (!arg.startsWith(`${PROTOCOL}:`)) continue;
    const route = deepLinkRoute(arg);
    if (route) return route;
  }
  return null;
}
