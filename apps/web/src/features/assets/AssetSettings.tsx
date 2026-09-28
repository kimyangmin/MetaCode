import {
  type AssetDto,
  type AssetKind,
  type AssetManifest,
  BUILTIN_CHARACTERS,
  CHARACTER_ASSET_LIMIT,
  COMMUNITY_ASSET_LIMIT,
  type CommunitySummary,
} from '@metacode/shared';
import { BUILTIN_ASSETS } from '@metacode/shared/builtin-assets';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ApiError } from '../../api/client';
import { useCommunities } from '../communities/hooks';
import { AssetPreview } from './AssetPreview';
import { deleteAsset, useCommunityAssets, useMyAssets } from './api';
import { fromManifest, newDoc } from './editorModel';
import { useAssetEditorStore } from './editorStore';

const isManager = (c: CommunitySummary) => c.myRole === 'OWNER' || c.myRole === 'ADMIN';

/**
 * 설정 → 에셋: 내 캐릭터와, 내가 소유자·관리자인 커뮤니티의 타일·오브젝트 목록.
 * 새로 그리거나 내장 에셋을 복제해서 도트 에디터로 연다.
 */
export function AssetSettings() {
  const communities = (useCommunities().data ?? []).filter(isManager);
  const [picker, setPicker] = useState<{ kinds: AssetKind[]; communityId: string | null } | null>(
    null,
  );
  return (
    <div className="settings-form asset-settings">
      <MyCharacters onPick={() => setPicker({ kinds: ['character'], communityId: null })} />
      {communities.map((community) => (
        <CommunityAssets
          key={community.id}
          community={community}
          onPick={() => setPicker({ kinds: ['tile', 'object'], communityId: community.id })}
        />
      ))}
      {communities.length === 0 && (
        <p className="form__hint">
          커뮤니티의 소유자나 관리자가 되면, 그 커뮤니티 광장에 쓸 타일과 오브젝트를 여기서 그릴 수
          있습니다.
        </p>
      )}
      {picker && (
        <BuiltinPicker
          kinds={picker.kinds}
          onClose={() => setPicker(null)}
          onPick={(manifest) => {
            setPicker(null);
            useAssetEditorStore.getState().open({
              mode: 'create',
              communityId: picker.communityId,
              doc: { ...fromManifest(manifest), name: `${manifest.name} 복사`.slice(0, 32) },
            });
          }}
        />
      )}
    </div>
  );
}

function MyCharacters({ onPick }: { onPick(): void }) {
  const assets = useMyAssets().data ?? [];
  const open = useAssetEditorStore((s) => s.open);
  const full = assets.length >= CHARACTER_ASSET_LIMIT;
  return (
    <section className="asset-section">
      <h3 className="settings-form__title">내 캐릭터</h3>
      <p className="form__hint">
        광장에서 쓸 캐릭터를 직접 그립니다. 대기·걷기(4방향)와 첨부 모션을 모두 그려야 저장할 수
        있습니다. ({assets.length}/{CHARACTER_ASSET_LIMIT})
      </p>
      <AssetGrid assets={assets} />
      <div className="asset-section__actions">
        <button
          type="button"
          className="button button--primary"
          disabled={full}
          onClick={() =>
            open({ mode: 'create', communityId: null, doc: newDoc('character', '새 캐릭터') })
          }
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
  const open = useAssetEditorStore((s) => s.open);
  const full = assets.length >= COMMUNITY_ASSET_LIMIT;
  const create = (kind: 'tile' | 'object') =>
    open({
      mode: 'create',
      communityId: community.id,
      doc: newDoc(kind, kind === 'tile' ? '새 타일' : '새 오브젝트', { w: 1, h: 2 }),
    });
  return (
    <section className="asset-section">
      <h3 className="settings-form__title">{community.name} · 타일과 오브젝트</h3>
      <p className="form__hint">
        이 커뮤니티의 분수 광장에 쓸 수 있습니다. 소유자와 관리자가 만들고 고칩니다. (
        {assets.length}/{COMMUNITY_ASSET_LIMIT})
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
      </div>
    </section>
  );
}

function AssetGrid({ assets }: { assets: AssetDto[] }) {
  const queryClient = useQueryClient();
  const open = useAssetEditorStore((s) => s.open);
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
              <AssetPreview manifest={asset.manifest} scale={previewScale(asset.manifest)} />
            </div>
            <strong title={asset.name}>{asset.name}</strong>
            <div className="asset-card__actions">
              <button
                type="button"
                className="button"
                onClick={() => open({ mode: 'edit', asset })}
              >
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

function previewScale(manifest: AssetManifest): number {
  return Math.max(1, Math.floor(64 / Math.max(manifest.width, manifest.height)));
}

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
            ×
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
                <AssetPreview manifest={manifest} scale={previewScale(manifest)} animate={false} />
                <span>{manifest.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
