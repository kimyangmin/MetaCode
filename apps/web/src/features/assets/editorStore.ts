import type { AssetDto } from '@metacode/shared';
import { create } from 'zustand';
import type { EditorDoc } from '@metacode/client';

/** 에디터로 여는 것: 새 에셋(빈 문서나 복제한 문서) 또는 저장된 에셋 */
export type EditorTarget =
  | { mode: 'create'; communityId: string | null; doc: EditorDoc }
  | { mode: 'edit'; asset: AssetDto };

interface AssetEditorState {
  target: EditorTarget | null;
  open(target: EditorTarget): void;
  close(): void;
}

export const useAssetEditorStore = create<AssetEditorState>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}));

interface MapEditorState {
  /** 맵 에디터로 연 커뮤니티. 닫혀 있으면 null */
  target: { communityId: string; name: string } | null;
  open(communityId: string, name: string): void;
  close(): void;
}

export const useMapEditorStore = create<MapEditorState>((set) => ({
  target: null,
  open: (communityId, name) => set({ target: { communityId, name } }),
  close: () => set({ target: null }),
}));
