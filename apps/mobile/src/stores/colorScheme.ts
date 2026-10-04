import * as SecureStore from 'expo-secure-store';
import { Appearance } from 'react-native';
import { create } from 'zustand';

/** 화면 밝기: 기기 설정을 따르거나 라이트·다크로 고정 (웹 stores/colorScheme.ts와 같은 세 가지) */
export type ColorSchemeChoice = 'system' | 'light' | 'dark';

const KEY = 'metacode.color-scheme';

interface ColorSchemeState {
  choice: ColorSchemeChoice;
  set(choice: ColorSchemeChoice): void;
}

function apply(choice: ColorSchemeChoice) {
  // 'unspecified'면 기기 설정을 다시 따른다. useColorScheme()이 이 값을 돌려주므로 useTheme이 따라온다
  Appearance.setColorScheme(choice === 'system' ? 'unspecified' : choice);
}

export const useColorSchemeStore = create<ColorSchemeState>((set) => ({
  choice: 'system',
  set: (choice) => {
    apply(choice);
    set({ choice });
    void (
      choice === 'system' ? SecureStore.deleteItemAsync(KEY) : SecureStore.setItemAsync(KEY, choice)
    ).catch(() => {});
  },
}));

/** 앱을 켤 때 기억해 둔 값을 적용한다 */
export async function restoreColorScheme(): Promise<void> {
  const saved = await SecureStore.getItemAsync(KEY).catch(() => null);
  if (saved !== 'light' && saved !== 'dark') return;
  apply(saved);
  useColorSchemeStore.setState({ choice: saved });
}
