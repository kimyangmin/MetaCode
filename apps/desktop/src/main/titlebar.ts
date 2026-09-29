import type { BrowserWindowConstructorOptions } from 'electron';

/**
 * 메인 창의 제목 표시줄은 웹 화면이 직접 그린다 (도움말, 커뮤니티 이름, 최소화·최대화·닫기).
 * - Windows·Linux: OS 제목 표시줄과 메뉴 막대 없이 띄우고, 창 조작 버튼도 웹이 그린다.
 * - macOS: 신호등 버튼은 OS 것을 그대로 두고(그 자리만 비움) 나머지를 웹이 그린다.
 * 웹은 preload가 넘겨준 인자(TITLEBAR_ARG)로 이 창이 어느 쪽인지 안다. 분리한 창은 OS 제목 표시줄을 쓴다.
 */
export const TITLEBAR_ARG = '--metacode-titlebar=';

export type TitleBarKind = 'custom' | 'native-controls';

export function titleBarKind(platform: NodeJS.Platform): TitleBarKind {
  return platform === 'darwin' ? 'native-controls' : 'custom';
}

export function titleBarWindowOptions(platform: NodeJS.Platform): BrowserWindowConstructorOptions {
  return titleBarKind(platform) === 'native-controls'
    ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 12, y: 10 } }
    : { frame: false };
}
