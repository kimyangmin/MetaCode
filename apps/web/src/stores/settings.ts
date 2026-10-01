import { create } from 'zustand';

export type SettingsSection =
  'account' | 'character' | 'assets' | 'appearance' | 'voice' | 'features';

interface SettingsState {
  /** 열린 설정 화면의 항목. 닫혀 있으면 null */
  section: SettingsSection | null;
  /**
   * 휴대폰에서 목록부터 보여 줄지. 항목을 정하지 않고 열면(⚙) 목록부터, 항목을 정해 열면
   * ("음성 설정 열기", 도움말) 그 항목의 내용을 바로 보여 준다.
   */
  listFirst: boolean;
  open(section?: SettingsSection): void;
  close(): void;
}

/** 설정 창 (사이드바 아래 ⚙, 마이크·헤드셋 팝업의 "음성 설정"에서 연다) */
export const useSettingsStore = create<SettingsState>((set) => ({
  section: null,
  listFirst: true,
  open: (section) => set({ section: section ?? 'account', listFirst: section === undefined }),
  close: () => set({ section: null }),
}));
