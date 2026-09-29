import { create } from 'zustand';

export type SettingsSection = 'account' | 'character' | 'assets' | 'voice' | 'features';

interface SettingsState {
  /** 열린 설정 화면의 항목. 닫혀 있으면 null */
  section: SettingsSection | null;
  open(section?: SettingsSection): void;
  close(): void;
}

/** 설정 창 (사이드바 아래 ⚙, 마이크·헤드셋 팝업의 "음성 설정"에서 연다) */
export const useSettingsStore = create<SettingsState>((set) => ({
  section: null,
  open: (section = 'account') => set({ section }),
  close: () => set({ section: null }),
}));
