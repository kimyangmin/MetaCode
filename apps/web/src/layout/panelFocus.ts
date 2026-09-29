import type { PanelKey } from './arrangement';

/**
 * 채팅·광장 사이 포커스 옮기기 (분할 화면이 처리한다, SplitView).
 * - Shift+Tab: 지금 있는 쪽의 반대편으로 (광장 ↔ 채팅 입력창)
 * - 광장에서 /: 채팅 입력창으로 (게임처럼 바로 말하기)
 * 옮길 패널이 접혀 있으면 펼친 뒤 옮긴다.
 */
export const PANEL_FOCUS_EVENT = 'metacode:focus-panel';

export function requestPanelFocus(panel: PanelKey): void {
  window.dispatchEvent(new CustomEvent<PanelKey>(PANEL_FOCUS_EVENT, { detail: panel }));
}

/** 패널 안에서 포커스를 줄 곳: 채팅은 입력창, 광장은 광장 자체(방향키를 받는 곳) */
export function panelFocusTarget(host: ParentNode, panel: PanelKey): HTMLElement | null {
  return panel === 'chat'
    ? host.querySelector<HTMLElement>('[data-panel="chat"] .composer textarea')
    : host.querySelector<HTMLElement>('[data-panel="plaza"] .plaza');
}

/** Shift+Tab을 가로채도 되는지: 분할 화면 안이나 아무 데도 포커스가 없을 때만 (대화 상자 등은 그대로 둔다) */
export function ownsFocus(host: HTMLElement, active: Element | null): boolean {
  return !active || active === document.body || host.contains(active);
}
