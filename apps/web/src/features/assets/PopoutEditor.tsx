import { type AssetDto, type AssetKind, AssetKind as Kinds } from '@metacode/shared';
import { BUILTIN_ASSETS } from '@metacode/shared/builtin-assets';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { ApiError, apiFetch } from '../../api/client';
import { useCommunities } from '../communities/hooks';
import { assetKeys } from './api';
import { type EditorTarget, useAssetEditorStore, useMapEditorStore } from './editorStore';
import { newEditorDoc } from './editorWindow';

/**
 * 에디터만 띄운 창 (/popout/editor/…, /popout/map/…). 메인 창에서 연 것이라 에디터를 닫으면 창도 닫는다.
 * 에디터는 앱에 하나만 둔 AssetEditors가 그리므로, 여기서는 열 것을 정해 스토어에 넣기만 한다.
 */
function useCloseWhenEditorCloses() {
  useEffect(() => {
    const close = (now: { target: unknown }, before: { target: unknown }) => {
      if (before.target && !now.target) window.close();
    };
    const stopPixel = useAssetEditorStore.subscribe(close);
    const stopMap = useMapEditorStore.subscribe(close);
    return () => {
      stopPixel();
      stopMap();
    };
  }, []);
}

/** 창 제목 (작업 표시줄·탭에서 어느 에디터인지 보이게) */
function useTitle(title: string) {
  useEffect(() => {
    document.title = `${title} - MetaCode`;
  }, [title]);
}

function Status({ children }: { children: string }) {
  return (
    <main className="center center--column popout-editor__status" role="status">
      <p>{children}</p>
      <button type="button" className="button" onClick={() => window.close()}>
        창 닫기
      </button>
    </main>
  );
}

const KINDS = new Set<string>(Object.values(Kinds));

export function PopoutAssetEditor() {
  const { assetId, kind } = useParams();
  const [search] = useSearchParams();
  const editing = !!assetId;
  const asset = useQuery({
    queryKey: assetKeys.one(assetId ?? ''),
    queryFn: () => apiFetch<AssetDto>(`/assets/${assetId}`),
    enabled: editing,
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
  });
  const target = useAssetEditorStore((s) => s.target);
  const started = useRef(false);
  useCloseWhenEditorCloses();

  // 새로 그리기: 빈 문서나 내장 에셋 복제. 고치기: 에셋을 받은 뒤.
  useEffect(() => {
    if (started.current) return;
    let next: EditorTarget | null = null;
    if (editing && asset.data) {
      next = { mode: 'edit', asset: asset.data };
    } else if (!editing && kind && KINDS.has(kind)) {
      const from = search.get('from');
      const builtin = from ? BUILTIN_ASSETS[from] : undefined;
      const communityId = search.get('community');
      next = {
        mode: 'create',
        communityId,
        doc: newEditorDoc(kind as AssetKind, builtin),
      };
    }
    if (!next) return;
    started.current = true;
    useAssetEditorStore.getState().open(next);
  }, [editing, asset.data, kind, search]);

  useTitle(
    target?.mode === 'edit'
      ? `${target.asset.name} 편집`
      : target?.mode === 'create'
        ? '새 에셋'
        : '도트 에디터',
  );

  if (editing && asset.isError) return <Status>에셋을 열지 못했습니다.</Status>;
  if (!editing && !(kind && KINDS.has(kind))) return <Status>열 수 없는 에셋입니다.</Status>;
  return <Status>에디터를 여는 중…</Status>;
}

export function PopoutMapEditor() {
  const { communityId = '' } = useParams();
  const communities = useCommunities();
  const community = communities.data?.find((c) => c.id === communityId);
  const started = useRef(false);
  useCloseWhenEditorCloses();

  useEffect(() => {
    if (started.current || !community) return;
    started.current = true;
    useMapEditorStore.getState().open(community.id, community.name);
  }, [community]);

  useTitle(community ? `${community.name} 광장 맵` : '맵 에디터');

  if (communities.data && !community) return <Status>이 커뮤니티를 볼 수 없습니다.</Status>;
  return <Status>맵 에디터를 여는 중…</Status>;
}
