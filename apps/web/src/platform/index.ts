import type { MetaCodeDesktopBridge } from '@metacode/shared';

/**
 * 웹/데스크톱 차이를 감추는 계층. 데스크톱 기능은 반드시 여기를 거쳐서 쓴다.
 * 브라우저에서는 브리지가 없으므로 웹 대체 동작으로 돌아간다.
 */
export function getDesktopBridge(): MetaCodeDesktopBridge | undefined {
  return window.metacode;
}

export function isDesktop(): boolean {
  return getDesktopBridge() !== undefined;
}
