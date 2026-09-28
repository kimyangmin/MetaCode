import type { ScreenSource } from '@metacode/shared';
import { useEffect, useState } from 'react';
import { getDesktopBridge } from '../../platform';
import { Dialog } from '../../ui/Dialog';
import {
  SCREEN_QUALITIES,
  type ScreenQuality,
  readScreenQuality,
  saveScreenQuality,
} from './screenQuality';

/**
 * 화면 공유 시작 창: 화질을 고르고, 데스크톱 앱이면 공유할 화면이나 창도 여기서 고른다
 * (브라우저는 "공유할 화면 고르기"를 누르면 브라우저 자체 선택 창이 뜬다).
 * 고르면 onStart(화질)를 부른다. 데스크톱은 그 전에 메인 프로세스에 고른 화면을 알린다.
 */
export function ScreenPicker({
  onStart,
  onClose,
}: {
  onStart(quality: ScreenQuality): void;
  onClose(): void;
}) {
  const screen = getDesktopBridge()?.screen;
  const [sources, setSources] = useState<ScreenSource[] | null>(null);
  const [error, setError] = useState(false);
  const [quality, setQuality] = useState(readScreenQuality);

  useEffect(() => {
    if (!screen) return;
    let cancelled = false;
    screen
      .getSources()
      .then((list) => !cancelled && setSources(list))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [screen]);

  const start = async (source?: ScreenSource) => {
    saveScreenQuality(quality);
    if (source) await screen?.select(source.id);
    onStart(quality);
  };

  const groups = [
    { title: '화면', items: sources?.filter((s) => s.kind === 'screen') ?? [] },
    { title: '창', items: sources?.filter((s) => s.kind === 'window') ?? [] },
  ];

  return (
    <Dialog title="화면 공유" onClose={onClose}>
      <div className="screen-picker">
        <fieldset className="screen-quality">
          <legend>화질</legend>
          {(Object.keys(SCREEN_QUALITIES) as ScreenQuality[]).map((key) => (
            <label key={key}>
              <input
                type="radio"
                name="screen-quality"
                checked={quality === key}
                onChange={() => setQuality(key)}
              />
              <span>{SCREEN_QUALITIES[key].label}</span>
              <small>{SCREEN_QUALITIES[key].detail}</small>
            </label>
          ))}
        </fieldset>
        <p className="form__hint">
          게임은 부드럽게나 최고를 권합니다. 인터넷이 느리면 화질을 먼저 낮추고 프레임은 지킵니다.
        </p>

        {!screen && (
          <button type="button" className="button button--primary" onClick={() => void start()}>
            공유할 화면 고르기
          </button>
        )}
        {screen && error && <p className="form__error">공유할 화면 목록을 불러오지 못했습니다.</p>}
        {screen && !sources && !error && <p className="form__hint">화면 목록을 불러오는 중…</p>}
        {groups.map(
          (group) =>
            group.items.length > 0 && (
              <section key={group.title}>
                <h3 className="screen-picker__title">{group.title}</h3>
                <div className="screen-picker__grid">
                  {group.items.map((source) => (
                    <button
                      key={source.id}
                      type="button"
                      className="screen-picker__item"
                      onClick={() => void start(source)}
                    >
                      <img src={source.thumbnail} alt="" />
                      <span title={source.name}>{source.name}</span>
                    </button>
                  ))}
                </div>
              </section>
            ),
        )}
      </div>
    </Dialog>
  );
}
