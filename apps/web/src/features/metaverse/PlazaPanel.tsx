import { type ReactNode, Suspense, lazy } from 'react';
import type { PlazaViewProps } from './PlazaView';

// Phaser는 크기가 커서 광장을 처음 열 때 불러온다.
const PlazaView = lazy(() => import('./PlazaView'));

interface PlazaPanelProps extends PlazaViewProps {
  title: string;
  /** 머리글 앞 아이콘 (분수 광장 ⛲, 모닥불 캠프 🔥) */
  icon: string;
  /** 머리글 오른쪽 (보기 전환 버튼) */
  actions?: ReactNode;
}

/** 메타버스 모드 패널: 머리글 + 광장 */
export function PlazaPanel({ title, icon, actions, ...view }: PlazaPanelProps) {
  return (
    <section className="plaza-panel" aria-label={title}>
      <header className="chat__header">
        <span className="chat__prefix" aria-hidden>
          {icon}
        </span>
        <h1>{title}</h1>
        {actions && <div className="chat__actions">{actions}</div>}
      </header>
      <Suspense fallback={<p className="plaza__status">광장을 불러오는 중…</p>}>
        <PlazaView key={view.plazaId} {...view} />
      </Suspense>
    </section>
  );
}
