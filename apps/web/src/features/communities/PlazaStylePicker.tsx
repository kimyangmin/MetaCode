import { PLAZA_STYLES, PlazaMap, PlazaStyle } from '@metacode/shared';
import { Suspense, lazy } from 'react';

// 미리보기는 내장 에셋(약 150KB)으로 그리므로 고르는 창을 열 때 따로 불러온다.
const PlazaThumbnail = lazy(() => import('../assets/PlazaThumbnail'));

export const PLAZA_STYLE_LABEL: Record<PlazaStyle, string> = {
  [PlazaStyle.TopDown]: '탑다운',
  [PlazaStyle.SideScroll]: '횡스크롤',
};

/** 조사까지 붙인 이름 (탑다운으로, 횡스크롤로) */
export const PLAZA_STYLE_TO: Record<PlazaStyle, string> = {
  [PlazaStyle.TopDown]: '탑다운으로',
  [PlazaStyle.SideScroll]: '횡스크롤로',
};

/** 방식마다 미리 보여 줄 내장 맵 */
const PREVIEW: Record<PlazaStyle, PlazaMap> = {
  [PlazaStyle.TopDown]: PlazaMap.FountainSquare,
  [PlazaStyle.SideScroll]: PlazaMap.FountainSide,
};

const DESCRIPTION: Record<PlazaStyle, string> = {
  [PlazaStyle.TopDown]: '위에서 내려다보는 광장. 방향키로 네 방향을 걷습니다.',
  [PlazaStyle.SideScroll]: '옆에서 보는 광장. 좌우로 걷고 점프해서 발판에 오릅니다.',
};

/** 광장 방식 고르기 (커뮤니티 만들기, 커뮤니티 설정 → 광장). 방식마다 내장 분수 광장을 미리 보여 준다 */
export function PlazaStylePicker({
  value,
  onChange,
  disabled = false,
  legend = '광장 방식',
}: {
  value: PlazaStyle;
  onChange(style: PlazaStyle): void;
  disabled?: boolean;
  legend?: string;
}) {
  return (
    <fieldset className="plaza-style" disabled={disabled}>
      <legend>{legend}</legend>
      {PLAZA_STYLES.map((style) => (
        <label key={style} className="plaza-style__option">
          <input
            type="radio"
            name="plaza-style"
            value={style}
            checked={value === style}
            onChange={() => onChange(style)}
            aria-label={`${PLAZA_STYLE_LABEL[style]}: ${DESCRIPTION[style]}`}
          />
          <span className="plaza-style__preview">
            <Suspense fallback={null}>
              <PlazaThumbnail map={PREVIEW[style]} />
            </Suspense>
          </span>
          <strong>{PLAZA_STYLE_LABEL[style]}</strong>
          <small>{DESCRIPTION[style]}</small>
        </label>
      ))}
    </fieldset>
  );
}
