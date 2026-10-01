import type { MouseEvent } from 'react';
import { type ColorSchemePreference, useColorSchemeStore } from '../../stores/colorScheme';

const OPTIONS: { id: ColorSchemePreference; label: string }[] = [
  { id: 'system', label: '기기 설정' },
  { id: 'light', label: '라이트' },
  { id: 'dark', label: '다크' },
];

/** 설정 → 화면: 라이트/다크 모드. 이 기기(브라우저)에만 기억한다 */
export function AppearanceSettings() {
  const preference = useColorSchemeStore((s) => s.preference);
  const setPreference = useColorSchemeStore((s) => s.setPreference);

  const choose = (id: ColorSchemePreference, e: MouseEvent<HTMLButtonElement>) => {
    // 키보드로 누르면 좌표가 없으므로 버튼 가운데에서 퍼지게 한다.
    const rect = e.currentTarget.getBoundingClientRect();
    const origin =
      e.detail === 0
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : { x: e.clientX, y: e.clientY };
    setPreference(id, origin);
  };

  return (
    <div className="settings-form">
      <h3 className="settings-form__title">색 모드</h3>
      <div className="scheme-picker" role="radiogroup" aria-label="색 모드">
        {OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={preference === option.id}
            className="scheme-picker__option"
            onClick={(e) => choose(option.id, e)}
          >
            <SchemePreview kind={option.id} />
            <span className="scheme-picker__label">{option.label}</span>
          </button>
        ))}
      </div>
      <p className="form__hint">
        기기 설정을 고르면 운영체제의 라이트/다크 모드가 바뀔 때 함께 바뀝니다. 이 기기에만
        저장됩니다.
      </p>
    </div>
  );
}

/** 앱 화면을 작게 줄인 그림 (목록 + 메시지 줄). 기기 설정은 반씩 나눠 보여 준다 */
function SchemePreview({ kind }: { kind: ColorSchemePreference }) {
  return (
    <span className="scheme-preview" data-kind={kind} aria-hidden>
      {(kind === 'system' ? (['light', 'dark'] as const) : [kind]).map((scheme) => (
        <span key={scheme} className="scheme-preview__half" data-scheme={scheme}>
          <span className="scheme-preview__sidebar">
            <span />
            <span />
            <span />
          </span>
          <span className="scheme-preview__chat">
            <span />
            <span />
            <span data-accent />
          </span>
        </span>
      ))}
    </span>
  );
}
