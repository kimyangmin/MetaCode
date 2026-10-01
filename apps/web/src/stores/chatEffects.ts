import { create } from 'zustand';

const DELETE_ANIMATION_KEY = 'metacode:delete-animation';

function readDeleteAnimation(): boolean {
  try {
    return localStorage.getItem(DELETE_ANIMATION_KEY) !== 'off';
  } catch {
    return true;
  }
}

interface ChatEffectsState {
  /** 메시지를 지울 때 재가 되어 사라지는 연출 (기본 켬) */
  deleteAnimation: boolean;
  setDeleteAnimation(on: boolean): void;
}

/** 채팅 연출 설정 (설정 → 화면). 이 기기(브라우저)에만 기억한다 */
export const useChatEffectsStore = create<ChatEffectsState>((set) => ({
  deleteAnimation: readDeleteAnimation(),
  setDeleteAnimation: (on) => {
    try {
      if (on) localStorage.removeItem(DELETE_ANIMATION_KEY);
      else localStorage.setItem(DELETE_ANIMATION_KEY, 'off');
    } catch {
      // 저장하지 못해도 이번 실행 동안은 따른다
    }
    set({ deleteAnimation: on });
  },
}));
