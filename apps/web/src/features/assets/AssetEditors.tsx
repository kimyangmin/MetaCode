import { Suspense, lazy } from 'react';
import { useAssetEditorStore, useMapEditorStore } from './editorStore';

// 도트 에디터와 맵 에디터는 내장 에셋(약 150KB)을 쓰므로 열 때 따로 불러온다.
const PixelEditor = lazy(() => import('./PixelEditor').then((m) => ({ default: m.PixelEditor })));
const MapEditor = lazy(() => import('./MapEditor').then((m) => ({ default: m.MapEditor })));

/**
 * 화면 전체로 뜨는 도트 에디터와 맵 에디터. 설정 창(내 캐릭터)과 커뮤니티 설정(광장 에셋) 어디서 열어도
 * 그 위에 뜨도록 앱에 하나만 둔다. 연 창이 닫히면 그 창이 에디터도 닫는다.
 */
export function AssetEditors() {
  const editing = useAssetEditorStore((s) => s.target);
  const mapEditing = useMapEditorStore((s) => s.target);
  return (
    <>
      {editing && (
        <Suspense fallback={null}>
          <PixelEditor
            key={editing.mode === 'edit' ? editing.asset.id : 'new'}
            target={editing}
            onClose={() => useAssetEditorStore.getState().close()}
          />
        </Suspense>
      )}
      {mapEditing && (
        <Suspense fallback={null}>
          <MapEditor
            key={mapEditing.communityId}
            communityId={mapEditing.communityId}
            communityName={mapEditing.name}
            onClose={() => useMapEditorStore.getState().close()}
          />
        </Suspense>
      )}
    </>
  );
}

/** 에디터를 연 창이 닫힐 때 에디터도 닫는다 (effect 정리 함수로 쓴다) */
export function closeAssetEditors() {
  useAssetEditorStore.getState().close();
  useMapEditorStore.getState().close();
}
