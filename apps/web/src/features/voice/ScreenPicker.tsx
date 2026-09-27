import type { ScreenSource } from '@metacode/shared';
import { useEffect, useState } from 'react';
import { getDesktopBridge } from '../../platform';
import { Dialog } from '../../ui/Dialog';

/**
 * 데스크톱 앱에서 공유할 화면이나 창 고르기. 브라우저는 자체 선택 창이 있어서 쓰지 않는다.
 * 고르면 메인 프로세스에 알리고 onPick을 부른다 (그 뒤 화면 공유를 시작한다).
 */
export function ScreenPicker({ onPick, onClose }: { onPick(): void; onClose(): void }) {
  const screen = getDesktopBridge()?.screen;
  const [sources, setSources] = useState<ScreenSource[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    screen
      ?.getSources()
      .then((list) => !cancelled && setSources(list))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [screen]);

  const pick = async (source: ScreenSource) => {
    await screen?.select(source.id);
    onPick();
  };

  const groups = [
    { title: '화면', items: sources?.filter((s) => s.kind === 'screen') ?? [] },
    { title: '창', items: sources?.filter((s) => s.kind === 'window') ?? [] },
  ];

  return (
    <Dialog title="화면 공유" onClose={onClose}>
      <div className="screen-picker">
        {error && <p className="form__error">공유할 화면 목록을 불러오지 못했습니다.</p>}
        {!sources && !error && <p className="form__hint">화면 목록을 불러오는 중…</p>}
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
                      onClick={() => void pick(source)}
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
