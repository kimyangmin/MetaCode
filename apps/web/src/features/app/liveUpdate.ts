import { useEffect, useState } from 'react';
import { useAssetEditorStore, useMapEditorStore } from '../assets/editorStore';
import { useVoiceStore } from '../voice/store';

/** 새 배포를 확인하는 간격 (창이 다시 보이거나 포커스를 얻을 때도 확인한다) */
const CHECK_INTERVAL_MS = 60_000;
/** 새 버전이 있는데 바로 새로 불러올 수 없을 때, 다시 볼 간격 */
const BUSY_RECHECK_MS = 5_000;

/** version.json 주소. 상대 경로(./)로 빌드한 앱은 페이지 주소마다 위치가 달라서 확인하지 않는다 */
export function versionUrl(base: string, origin: string): string | null {
  return base.startsWith('/') ? `${origin}${base}version.json` : null;
}

export interface BusyState {
  inCall: boolean;
  editing: boolean;
  typing: boolean;
}

/** 지금 새로 불러와도 잃는 것이 없는지: 통화 중, 에디터를 연 채, 입력하던 글이 있으면 기다린다 */
export function canReloadNow(state: BusyState): boolean {
  return !state.inCall && !state.editing && !state.typing;
}

function busyState(): BusyState {
  const fields = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    'textarea, input[type="text"], input:not([type])',
  );
  return {
    inCall: !!useVoiceStore.getState().session,
    editing: !!useAssetEditorStore.getState().target || !!useMapEditorStore.getState().target,
    typing: Array.from(fields).some((field) => field.value.trim() !== ''),
  };
}

/**
 * 웹을 새로 배포하면 떠 있는 앱(브라우저 탭, 데스크톱 앱)이 알아서 새 화면을 불러오게 한다.
 * 빌드 번호(version.json)를 주기적으로 보고, 바뀌었으면 잃을 것이 없을 때 새로 불러온다.
 * 통화 중이거나 쓰던 글·편집 중인 에셋이 있으면 기다리고, 그동안 안내를 띄운다 (available).
 */
export function useLiveUpdate(): { available: boolean; reloadNow(): void } {
  const [available, setAvailable] = useState(false);
  const url = import.meta.env.DEV ? null : versionUrl(import.meta.env.BASE_URL, location.origin);

  useEffect(() => {
    if (!url || available) return;
    let stopped = false;
    const check = async () => {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) return;
        const { build } = (await res.json()) as { build?: string };
        if (!stopped && build && build !== __BUILD_ID__) setAvailable(true);
      } catch {
        // 연결이 잠깐 끊겼다: 다음에 다시 본다.
      }
    };
    const onVisible = () => document.visibilityState === 'visible' && void check();
    const timer = setInterval(() => void check(), CHECK_INTERVAL_MS);
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [url, available]);

  useEffect(() => {
    if (!available) return;
    const tryReload = () => {
      if (canReloadNow(busyState())) location.reload();
    };
    tryReload();
    const timer = setInterval(tryReload, BUSY_RECHECK_MS);
    return () => clearInterval(timer);
  }, [available]);

  return { available, reloadNow: () => location.reload() };
}
