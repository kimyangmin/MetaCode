import {
  type AssetDto,
  type AssetKind,
  type AssetManifest,
  BUILTIN_CHARACTERS,
  CHARACTER_ASSET_LIMIT,
  COMMUNITY_ASSET_LIMIT,
  type CommunitySummary,
  PlazaStyle,
  characterStyle,
} from '@metacode/shared';
import { BUILTIN_ASSETS } from '@metacode/shared/builtin-assets';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ApiError } from '../../api/client';
import { AssetPreview } from './AssetPreview';
import { deleteAsset, useCommunityAssets, useMyAssets } from './api';
import { newEditorDoc, openAssetEditor, openMapEditor } from './editorWindow';
import { Map as MapIcon, X } from 'lucide-react';

/**
 * 설정 → 에셋: 내 캐릭터 목록. 새로 그리거나 내장 캐릭터를 복제해서 도트 에디터로 연다.
 * 커뮤니티의 타일·오브젝트는 커뮤니티 설정 → 광장에 있다 (CommunityPlazaAssets).
 */
export function AssetSettings() {
  const [picking, setPicking] = useState(false);
  return (
    <div className="settings-form asset-settings">
      <MyCharacters onPick={() => setPicking(true)} />
      <p className="form__hint">
        커뮤니티 광장에 쓸 타일·오브젝트와 광장 맵은 커뮤니티 이름 옆 메뉴의 커뮤니티 설정 →
        광장에서 만듭니다 (소유자·관리자).
      </p>
      {picking && (
        <BuiltinPicker
          kinds={['character']}
          onClose={() => setPicking(false)}
          onPick={(manifest) => {
            setPicking(false);
            openCopy(manifest, null);
          }}
        />
      )}
    </div>
  );
}

/** 커뮤니티 설정 → 광장: 이 커뮤니티의 타일·오브젝트 목록과 광장 맵 편집 */
export function CommunityPlazaAssets({ community }: { community: CommunitySummary }) {
  const [picking, setPicking] = useState(false);
  return (
    <div className="asset-settings">
      <CommunityAssets community={community} onPick={() => setPicking(true)} />
      {picking && (
        <BuiltinPicker
          kinds={['tile', 'object']}
          onClose={() => setPicking(false)}
          onPick={(manifest) => {
            setPicking(false);
            openCopy(manifest, community.id);
          }}
        />
      )}
    </div>
  );
}

/** 내장 에셋을 복제해서 도트 에디터로 연다 */
function openCopy(manifest: AssetManifest, communityId: string | null) {
  const from = Object.entries(BUILTIN_ASSETS).find(([, m]) => m === manifest)?.[0];
  openAssetEditor({ kind: 'new', assetKind: manifest.kind, communityId, from }, () => ({
    mode: 'create',
    communityId,
    doc: newEditorDoc(manifest.kind, manifest),
  }));
}

/** 새로 그리기 */
function openNew(kind: AssetKind, communityId: string | null) {
  openAssetEditor({ kind: 'new', assetKind: kind, communityId }, () => ({
    mode: 'create',
    communityId,
    doc: newEditorDoc(kind),
  }));
}

/** 저장된 에셋 고치기 */
function openEdit(asset: AssetDto) {
  openAssetEditor({ kind: 'edit', assetId: asset.id }, () => ({ mode: 'edit', asset }));
}

function MyCharacters({ onPick }: { onPick(): void }) {
  const assets = useMyAssets().data ?? [];
  const full = assets.length >= CHARACTER_ASSET_LIMIT;
  return (
    <section className="asset-section">
      <h3 className="settings-form__title">내 캐릭터</h3>
      <p className="form__hint">
        광장에서 쓸 캐릭터를 직접 그립니다 ({assets.length}/{CHARACTER_ASSET_LIMIT}). 에디터의 광장
        방식에서 탑다운용(대기·걷기 4방향)과 횡스크롤용(오른쪽을 보는 대기·걷기·점프, 왼쪽은 좌우
        반전)을 고르고, 필요한 애니메이션을 모두 그려야 저장할 수 있습니다. 에디터는 새 창으로
        열려서 그리는 동안에도 채팅과 광장을 볼 수 있습니다.
      </p>
      <AssetGrid assets={assets} />
      <div className="asset-section__actions">
        <button
          type="button"
          className="button button--primary"
          disabled={full}
          onClick={() => openNew('character', null)}
        >
          새 캐릭터
        </button>
        <button type="button" className="button" disabled={full} onClick={onPick}>
          기본 캐릭터에서 시작
        </button>
      </div>
    </section>
  );
}

function CommunityAssets({ community, onPick }: { community: CommunitySummary; onPick(): void }) {
  const assets = useCommunityAssets(community.id).data ?? [];
  const full = assets.length >= COMMUNITY_ASSET_LIMIT;
  const create = (kind: 'tile' | 'object') => openNew(kind, community.id);
  return (
    <section className="asset-section">
      <h3 className="settings-form__title">타일과 오브젝트</h3>
      <p className="form__hint">
        이 커뮤니티의 분수 광장에 쓸 수 있습니다. 소유자와 관리자가 만들고, 광장 맵 편집에서
        배치합니다. ({assets.length}/{COMMUNITY_ASSET_LIMIT})
      </p>
      <AssetGrid assets={assets} />
      <div className="asset-section__actions">
        <button
          type="button"
          className="button button--primary"
          disabled={full}
          onClick={() => create('tile')}
        >
          새 타일
        </button>
        <button type="button" className="button" disabled={full} onClick={() => create('object')}>
          새 오브젝트
        </button>
        <button type="button" className="button" disabled={full} onClick={onPick}>
          내장 에셋에서 시작
        </button>
        <button
          type="button"
          className="button"
          onClick={() => openMapEditor(community.id, community.name)}
        >
          <MapIcon aria-hidden /> 광장 맵 편집
        </button>
      </div>
    </section>
  );
}

function AssetGrid({ assets }: { assets: AssetDto[] }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  if (assets.length === 0) return null;
  const remove = async (asset: AssetDto) => {
    if (!window.confirm(`'${asset.name}'을(를) 지울까요? 되돌릴 수 없습니다.`)) return;
    setError(null);
    try {
      await deleteAsset(queryClient, asset);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '지우지 못했습니다.');
    }
  };
  return (
    <>
      <ul className="asset-grid">
        {assets.map((asset) => (
          <li key={asset.id} className="asset-card">
            <div className="asset-card__preview">
              <AssetPreview manifest={asset.manifest} box={PREVIEW_BOX} />
            </div>
            <strong title={asset.name}>{asset.name}</strong>
            {asset.kind === 'character' &&
              characterStyle(asset.manifest) === PlazaStyle.SideScroll && (
                <span className="asset-card__badge">횡스크롤</span>
              )}
            <div className="asset-card__actions">
              <button type="button" className="button" onClick={() => openEdit(asset)}>
                편집
              </button>
              <button
                type="button"
                className="button button--danger"
                onClick={() => void remove(asset)}
              >
                삭제
              </button>
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <p className="form__error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/** 목록 카드의 미리보기 크기 (가장 긴 변, px) */
const PREVIEW_BOX = 64;

const BUILTIN_LIST = Object.values(BUILTIN_ASSETS);

/** 내장 에셋 고르기: 복제해서 새로 그리는 출발점 */
function BuiltinPicker({
  kinds,
  onPick,
  onClose,
}: {
  kinds: AssetKind[];
  onPick(manifest: AssetManifest): void;
  onClose(): void;
}) {
  const [kind, setKind] = useState(kinds[0]!);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // 설정 창까지 닫히지 않게 한다.
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const list =
    kind === 'character'
      ? BUILTIN_CHARACTERS.map((ref) => BUILTIN_ASSETS[ref]!)
      : BUILTIN_LIST.filter((m) => m.kind === kind);
  return (
    <div
      className="dialog__overlay asset-picker__overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="dialog asset-picker" role="dialog" aria-label="내장 에셋 고르기">
        <header className="dialog__header">
          <h2>내장 에셋에서 시작</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="닫기">
            <X aria-hidden />
          </button>
        </header>
        {kinds.length > 1 && (
          <div className="tabs" role="tablist">
            {kinds.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={kind === k}
                onClick={() => setKind(k)}
              >
                {k === 'tile' ? '타일' : k === 'object' ? '오브젝트' : '캐릭터'}
              </button>
            ))}
          </div>
        )}
        <ul className="asset-picker__list">
          {list.map((manifest, i) => (
            <li key={i}>
              <button type="button" title={manifest.name} onClick={() => onPick(manifest)}>
                <AssetPreview manifest={manifest} box={PREVIEW_BOX} animate={false} />
                <span>{manifest.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
