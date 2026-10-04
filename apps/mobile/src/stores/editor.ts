import type { EditorDoc } from '@metacode/client';
import type { AssetDto } from '@metacode/shared';
import { create } from 'zustand';

/** 에디터로 여는 것: 새 에셋(빈 문서나 복제한 문서) 또는 저장된 에셋 (웹 editorStore와 같은 모양) */
export type EditorTarget =
  | { mode: 'create'; communityId: string | null; doc: EditorDoc }
  | { mode: 'edit'; asset: AssetDto };

/** 맵 에디터로 여는 커뮤니티 광장 */
export interface MapEditorTarget {
  communityId: string;
  communityName: string;
}

interface EditorState {
  target: EditorTarget | null;
  map: MapEditorTarget | null;
}

export const useEditorStore = create<EditorState>(() => ({ target: null, map: null }));

export const openEditor = (target: EditorTarget) => useEditorStore.setState({ target });
export const openMapEditor = (map: MapEditorTarget) => useEditorStore.setState({ map });
