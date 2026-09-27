import { create } from 'zustand';

const MEMBERS_HIDDEN_KEY = 'metacode:members-hidden';

function readHidden(): boolean {
  try {
    return localStorage.getItem(MEMBERS_HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

interface UiState {
  /** 커뮤니티 화면 오른쪽 멤버 목록을 숨겼는지 (기억한다) */
  membersHidden: boolean;
  toggleMembers(): void;
}

export const useUiStore = create<UiState>((set, get) => ({
  membersHidden: readHidden(),
  toggleMembers: () => {
    const next = !get().membersHidden;
    try {
      localStorage.setItem(MEMBERS_HIDDEN_KEY, next ? '1' : '0');
    } catch {
      // 기억하지 못해도 지금 화면에는 적용된다.
    }
    set({ membersHidden: next });
  },
}));
