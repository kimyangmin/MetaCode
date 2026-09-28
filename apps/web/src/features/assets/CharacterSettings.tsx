import {
  type AssetManifest,
  BUILTIN_CHARACTERS,
  COLOR_SLOTS,
  COLOR_PRESETS,
  type CharacterChoice,
  type ColorSlot,
  type UserDetail,
  characterKey,
  characterPalette,
  defaultCharacter,
} from '@metacode/shared';
import { BUILTIN_ASSETS } from '@metacode/shared/builtin-assets';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, apiFetch } from '../../api/client';
import { jsonBody } from '../../api/queries';
import { meQueryKey } from '../auth/auth';
import { AssetPreview } from './AssetPreview';
import { useMyAssets } from './api';

const SLOT_LABEL: Record<ColorSlot, string> = {
  skin: '피부',
  hair: '머리',
  shirt: '윗옷',
  pants: '바지',
  shoes: '신발',
};

const DIRECTIONS = ['down', 'left', 'right', 'up'] as const;

/** 미리보기 크기 (가장 긴 변, px). 캐릭터 해상도가 저마다 달라도 늘 같은 크기로 보인다 */
const STAGE_BOX = 192;
const SMALL_BOX = 64;

/**
 * 설정 → 캐릭터: 광장에서 쓸 캐릭터를 고른다. 기본 캐릭터는 부위마다 색을 바꿀 수 있고,
 * 직접 그린 캐릭터(설정 → 에셋)도 고를 수 있다.
 */
export function CharacterSettings({ me }: { me: UserDetail }) {
  const queryClient = useQueryClient();
  const mine = useMyAssets().data ?? [];
  const saved: CharacterChoice = me.character ?? defaultCharacter(me.id);
  const [choice, setChoice] = useState<CharacterChoice>(saved);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const options: { ref: string; manifest: AssetManifest }[] = [
    ...BUILTIN_CHARACTERS.map((ref) => ({ ref, manifest: BUILTIN_ASSETS[ref]! })),
    ...mine.map((asset) => ({ ref: asset.id, manifest: asset.manifest })),
  ];
  const selected = options.find((o) => o.ref === choice.asset) ?? options[0]!;
  const palette = characterPalette(selected.manifest, choice.colors);
  const slots = COLOR_SLOTS.filter((slot) => selected.manifest.colorSlots?.[slot]);
  const dirty = characterKey(choice) !== characterKey(saved);

  const save = async (character: CharacterChoice | null, ok: string) => {
    setBusy(true);
    setStatus(null);
    try {
      const detail = await apiFetch<UserDetail>('/users/me/character', {
        method: 'PUT',
        ...jsonBody({ character }),
      });
      queryClient.setQueryData(meQueryKey, detail);
      setChoice(detail.character ?? defaultCharacter(me.id));
      setStatus({ kind: 'ok', text: ok });
    } catch (err) {
      setStatus({
        kind: 'error',
        text: err instanceof ApiError ? err.message : '저장하지 못했습니다.',
      });
    } finally {
      setBusy(false);
    }
  };

  // 색은 부위가 있는 캐릭터에만 남긴다 (직접 그린 캐릭터에는 보내지 않는다).
  const pick = (ref: string, manifest: AssetManifest) =>
    setChoice({
      asset: ref,
      colors: manifest.colorSlots ? { ...defaultCharacter(me.id).colors, ...choice.colors } : {},
    });

  return (
    <div className="settings-form character-settings">
      <div className="character-settings__stage">
        <AssetPreview manifest={selected.manifest} box={STAGE_BOX} palette={palette} />
        <div className="character-settings__turn">
          {DIRECTIONS.map((dir) => (
            <AssetPreview
              key={dir}
              manifest={selected.manifest}
              box={SMALL_BOX}
              palette={palette}
              animation={`walk-${dir}`}
            />
          ))}
        </div>
      </div>

      <h3 className="settings-form__title">캐릭터</h3>
      <ul className="asset-grid character-settings__options">
        {options.map((option) => (
          <li key={option.ref}>
            <button
              type="button"
              className="asset-card character-settings__option"
              aria-pressed={option.ref === selected.ref}
              onClick={() => pick(option.ref, option.manifest)}
            >
              <span className="asset-card__preview">
                <AssetPreview
                  manifest={option.manifest}
                  box={SMALL_BOX}
                  animate={false}
                  animation="idle-down"
                  palette={
                    option.manifest.colorSlots
                      ? characterPalette(option.manifest, choice.colors)
                      : undefined
                  }
                />
              </span>
              <strong>{option.manifest.name}</strong>
            </button>
          </li>
        ))}
      </ul>
      {mine.length === 0 && (
        <p className="form__hint">설정 → 에셋에서 캐릭터를 직접 그리면 여기서 고를 수 있습니다.</p>
      )}

      {slots.length > 0 && (
        <>
          <h3 className="settings-form__title">색</h3>
          {slots.map((slot) => (
            <div key={slot} className="character-settings__slot">
              <span>{SLOT_LABEL[slot]}</span>
              {COLOR_PRESETS[slot].map((color) => (
                <button
                  key={color}
                  type="button"
                  className="pixel-editor__swatch"
                  style={{ background: color }}
                  aria-pressed={choice.colors[slot] === color}
                  aria-label={`${SLOT_LABEL[slot]} ${color}`}
                  onClick={() =>
                    setChoice({ ...choice, colors: { ...choice.colors, [slot]: color } })
                  }
                />
              ))}
              <input
                type="color"
                value={choice.colors[slot] ?? '#000000'}
                aria-label={`${SLOT_LABEL[slot]} 색 직접 고르기`}
                onChange={(e) =>
                  setChoice({ ...choice, colors: { ...choice.colors, [slot]: e.target.value } })
                }
              />
            </div>
          ))}
        </>
      )}

      <div className="settings-form__footer">
        {status && (
          <p className={status.kind === 'ok' ? 'form__ok' : 'form__error'} role="status">
            {status.text}
          </p>
        )}
        <button
          type="button"
          className="button"
          disabled={busy || me.character === null}
          onClick={() => void save(null, '기본 캐릭터로 되돌렸습니다.')}
        >
          기본으로 되돌리기
        </button>
        <button
          type="button"
          className="button button--primary"
          disabled={busy || !dirty}
          onClick={() => void save({ asset: selected.ref, colors: choice.colors }, '저장했습니다.')}
        >
          저장
        </button>
      </div>
    </div>
  );
}
