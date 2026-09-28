import data from './builtin/assets.json' with { type: 'json' };
import type { AssetManifest, AssetRef } from './manifest.js';

/**
 * 내장 에셋: Kenney Tiny Town 타일(`builtin:tt-<번호>`), 직접 그린 오브젝트(분수, 모닥불 등), 기본 캐릭터.
 * `pnpm assets:build`가 assets/vendor의 원본과 tools/assets의 그림으로 만든다.
 */
export const BUILTIN_ASSETS = data as unknown as Readonly<Record<AssetRef, AssetManifest>>;

export function builtinAsset(ref: AssetRef): AssetManifest | undefined {
  return Object.hasOwn(BUILTIN_ASSETS, ref) ? BUILTIN_ASSETS[ref] : undefined;
}
