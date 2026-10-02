import type { AssetKind, AssetManifest } from '@metacode/shared';
import type { QueryClient } from '@tanstack/react-query';
import { isAndroidApp } from '../../platform';
import { appUrl } from '../../stores/layout';
import { PHONE_QUERY } from '../../ui/useMediaQuery';
import { type EditorDoc, fromManifest, newDoc } from './editorModel';
import { type EditorTarget, useAssetEditorStore, useMapEditorStore } from './editorStore';

/**
 * 에디터를 메타코드 창과 따로 띄운다: 도트 에디터·맵 에디터를 새 창(분리한 창과 같은 /popout/ 주소)으로 열어,
 * 그리는 동안에도 메인 창에서 채팅·광장·화면 공유를 볼 수 있게 한다. 새 창은 앱 전체를 따로 띄우므로 실시간
 * 연결과 쿼리 캐시가 따로다. 저장·삭제하면 BroadcastChannel로 다른 창에 알려 에셋 목록을 다시 받게 한다.
 * 휴대폰 화면, 안드로이드 앱, 팝업이 막힌 경우에는 예전처럼 앱 화면 위에 띄운다.
 */

/** 새 창으로 여는 에디터 (주소에 담는다) */
export type EditorRequest =
  | { kind: 'edit'; assetId: string }
  | {
      kind: 'new';
      assetKind: AssetKind;
      communityId: string | null;
      /** 내장 에셋을 복제해서 시작 (builtin:<이름>) */
      from?: string;
    }
  | { kind: 'map'; communityId: string };

export function editorPath(request: EditorRequest): string {
  if (request.kind === 'edit') return `/popout/editor/asset/${request.assetId}`;
  if (request.kind === 'map') return `/popout/map/${request.communityId}`;
  const query = new URLSearchParams();
  if (request.communityId) query.set('community', request.communityId);
  if (request.from) query.set('from', request.from);
  const search = query.toString();
  return `/popout/editor/new/${request.assetKind}${search ? `?${search}` : ''}`;
}

/** 새로 그리는 에셋의 처음 문서 (빈 문서 또는 내장 에셋 복제) */
export function newEditorDoc(kind: AssetKind, builtin?: AssetManifest): EditorDoc {
  if (builtin) return { ...fromManifest(builtin), name: `${builtin.name} 복사`.slice(0, 32) };
  if (kind === 'character') return newDoc('character', '새 캐릭터');
  if (kind === 'tile') return newDoc('tile', '새 타일');
  return newDoc('object', '새 오브젝트', { w: 1, h: 2 });
}

/** 새 창으로 열 수 있는 환경인지 (휴대폰 화면·안드로이드 앱은 앱 화면 위에 띄운다) */
export function canOpenEditorWindow(): boolean {
  if (isAndroidApp()) return false;
  return !window.matchMedia?.(PHONE_QUERY).matches;
}

/** 연 에디터 창 (같은 에셋을 다시 열면 새로 불러오지 않고 그 창을 앞으로) */
const windows = new Map<string, Window>();

function windowName(request: EditorRequest): string {
  if (request.kind === 'edit') return `metacode-editor-${request.assetId}`;
  if (request.kind === 'map') return `metacode-map-${request.communityId}`;
  return `metacode-editor-new-${Date.now().toString(36)}`;
}

/** 에디터 창 크기: 화면에 들어가는 만큼 넓게 */
function features(): string {
  const width = Math.min(1360, Math.max(900, (window.screen?.availWidth ?? 1400) - 80));
  const height = Math.min(900, Math.max(640, (window.screen?.availHeight ?? 900) - 80));
  return `popup,width=${width},height=${height}`;
}

/** 새 창으로 연다. 열지 못하면(팝업 차단 등) false */
function openWindow(request: EditorRequest): boolean {
  const name = windowName(request);
  const existing = windows.get(name);
  if (existing && !existing.closed) {
    // 같은 이름으로 window.open을 다시 부르면 그 창을 새로 불러와 그리던 것을 잃는다.
    existing.focus();
    return true;
  }
  const popup = window.open(appUrl(editorPath(request)), name, features());
  if (!popup) return false;
  windows.set(name, popup);
  popup.focus();
  return true;
}

/**
 * 도트 에디터를 연다: 새 창으로, 안 되면 앱 화면 위에. target은 앱 화면 위에 띄울 때 쓴다.
 */
export function openAssetEditor(request: EditorRequest, target: () => EditorTarget): void {
  if (canOpenEditorWindow() && openWindow(request)) return;
  useAssetEditorStore.getState().open(target());
}

/** 맵 에디터를 연다: 새 창으로, 안 되면 앱 화면 위에 */
export function openMapEditor(communityId: string, name: string): void {
  if (canOpenEditorWindow() && openWindow({ kind: 'map', communityId })) return;
  useMapEditorStore.getState().open(communityId, name);
}

// 메인 창을 닫으면 에디터 창은 그대로 둔다 (그리던 것을 잃지 않게). 에디터 창은 따로 로그인 상태를 쓴다.

// ── 창 사이 알림 ──

const CHANNEL = 'metacode-assets';

interface AssetsChanged {
  type: 'assets-changed';
  communityId?: string | null;
}

let channel: BroadcastChannel | null | undefined;
function assetChannel(): BroadcastChannel | null {
  if (channel === undefined) {
    channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);
  }
  return channel;
}

/** 다른 창(메인 창, 다른 에디터 창)에 에셋이나 맵이 바뀌었다고 알린다 */
export function announceAssetsChanged(communityId?: string | null): void {
  const message: AssetsChanged = { type: 'assets-changed', communityId };
  assetChannel()?.postMessage(message);
}

/** 다른 창에서 바뀐 에셋·맵을 이 창의 캐시에 반영한다 (App이 한 번 건다). 그만 들으려면 돌려준 함수를 부른다 */
export function listenAssetsChanged(queryClient: QueryClient): () => void {
  const bus = assetChannel();
  if (!bus) return () => {};
  const onMessage = (e: MessageEvent<AssetsChanged>) => {
    if (e.data?.type !== 'assets-changed') return;
    void queryClient.invalidateQueries({ queryKey: ['assets'] });
    if (e.data.communityId) {
      void queryClient.invalidateQueries({ queryKey: ['community-map', e.data.communityId] });
    }
  };
  bus.addEventListener('message', onMessage);
  return () => bus.removeEventListener('message', onMessage);
}
