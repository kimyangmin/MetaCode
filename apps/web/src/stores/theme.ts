import { useEffect } from 'react';
import { create } from 'zustand';

/** 화면 색 모드 고르기. system이면 기기(OS) 설정을 따른다 */
export type ThemePreference = 'system' | 'light' | 'dark';
export type ColorScheme = 'light' | 'dark';

/** index.html의 첫 화면 스크립트도 같은 키를 읽는다 (그리기 전에 data-theme을 정해 깜빡이지 않게) */
export const THEME_STORAGE_KEY = 'metacode:theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function readPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    if (value === 'light' || value === 'dark') return value;
  } catch {
    // 저장소를 못 쓰면 기기 설정을 따른다
  }
  return 'system';
}

export function resolveScheme(preference: ThemePreference, systemDark: boolean): ColorScheme {
  if (preference !== 'system') return preference;
  return systemDark ? 'dark' : 'light';
}

function systemDark(): boolean {
  return window.matchMedia?.(DARK_QUERY).matches ?? false;
}

/** 누른 자리 (여기서부터 새 색이 원으로 퍼진다). 없으면 화면 가운데 */
export interface TransitionOrigin {
  x: number;
  y: number;
}

/** 진행 중인 전환이 바꿀 값 */
let switching: { scheme: ColorScheme } | null = null;

/**
 * `<html data-theme>`을 바꾼다. 브라우저가 View Transitions를 지원하면 지금 화면을 찍어 두고
 * 새 색의 화면이 누른 자리에서 원으로 퍼지게 한다 (styles.css의 [data-theme-switching]).
 * 움직임 줄이기 설정이면 바로 바꾼다.
 */
function applyScheme(scheme: ColorScheme, origin?: TransitionOrigin) {
  const root = document.documentElement;
  // 전환 중에는 data-theme이 아직 예전 값이다 (화면을 찍은 뒤에 바뀜). 그 사이 useThemeSync가 같은 값으로
  // 다시 부르면 새 전환이 앞의 것을 끊고 화면 가운데에서 다시 시작했으므로, 바꾸는 중인 값과 비교한다.
  if ((switching?.scheme ?? root.dataset.theme) === scheme) return;
  const update = () => {
    root.dataset.theme = scheme;
  };
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!document.startViewTransition || reduced || document.visibilityState !== 'visible') {
    switching = null;
    update();
    return;
  }
  const x = origin?.x ?? window.innerWidth / 2;
  const y = origin?.y ?? window.innerHeight / 2;
  // 가장 먼 모서리까지 덮는 반지름
  const radius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  );
  const mine = { scheme };
  switching = mine;
  root.dataset.themeSwitching = '';
  const transition = document.startViewTransition(update);
  transition.ready
    .then(() =>
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        {
          duration: 450,
          easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
          pseudoElement: '::view-transition-new(root)',
        },
      ),
    )
    .catch(() => {});
  transition.finished
    .finally(() => {
      // 빨리 다시 바꿔서 다음 전환이 시작했으면 표시는 그 전환이 지운다.
      if (switching !== mine) return;
      switching = null;
      delete root.dataset.themeSwitching;
    })
    .catch(() => {});
}

interface ThemeState {
  preference: ThemePreference;
  setPreference(preference: ThemePreference, origin?: TransitionOrigin): void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  preference: readPreference(),
  setPreference: (preference, origin) => {
    try {
      if (preference === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      // 기억하지 못해도 이번에는 바꾼다
    }
    set({ preference });
    applyScheme(resolveScheme(preference, systemDark()), origin);
  },
}));

/**
 * 앱에 한 번: 고른 값대로 data-theme을 맞추고, 기기 설정을 따르는 동안 OS의 라이트/다크가 바뀌면 따라 바꾸고,
 * 다른 창에서 바꾸면 이 창도 따른다.
 */
export function useThemeSync() {
  const preference = useThemeStore((s) => s.preference);
  useEffect(() => {
    applyScheme(resolveScheme(preference, systemDark()));
    if (preference !== 'system' || !window.matchMedia) return;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = () => applyScheme(resolveScheme('system', query.matches));
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [preference]);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY || e.key === null) {
        useThemeStore.setState({ preference: readPreference() });
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
}
