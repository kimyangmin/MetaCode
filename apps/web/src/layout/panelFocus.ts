import type { PanelKey } from './arrangement';

/**
 * 채팅·광장 사이 포커스 옮기기 (분할 화면이 처리한다, SplitView).
 * - Shift+Tab: 지금 있는 쪽의 반대편으로 (광장 ↔ 채팅 입력창)
 * - 광장에서 /: 채팅 입력창으로 (게임처럼 바로 말하기). 보내거나 Esc를 누르면 광장으로 돌아간다.
 * 옮길 패널이 접혀 있으면 펼친 뒤 옮긴다.
 */
export const PANEL_FOCUS_EVENT = 'metacode:focus-panel';

export interface PanelFocusRequest {
  panel: PanelKey;
  /** 그 패널에서 할 일을 마치면(메시지를 보내면) 돌아갈 패널 */
  returnTo?: PanelKey;
}

export function requestPanelFocus(panel: PanelKey, returnTo?: PanelKey): void {
  window.dispatchEvent(
    new CustomEvent<PanelFocusRequest>(PANEL_FOCUS_EVENT, { detail: { panel, returnTo } }),
  );
}

/**
 * 돌아갈 곳은 포커스를 받은 요소에 적어 둔다 (data-return-focus). 다른 곳으로 포커스가 나가면
 * 지우므로, 사용자가 직접 입력창을 눌러 쓴 메시지는 보내도 광장으로 가지 않는다.
 */
export const RETURN_FOCUS_ATTR = 'data-return-focus';

/** 입력창에서 할 일을 마쳤을 때: 돌아갈 패널이 적혀 있으면 그리로 옮기고 true */
export function returnPanelFocus(element: HTMLElement | null): boolean {
  const target = element?.getAttribute(RETURN_FOCUS_ATTR);
  if (target !== 'chat' && target !== 'plaza') return false;
  element!.removeAttribute(RETURN_FOCUS_ATTR);
  requestPanelFocus(target);
  return true;
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
