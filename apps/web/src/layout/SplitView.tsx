import { type DragEvent, type ReactNode, useRef, useState } from 'react';
import {
  type LayoutStorage,
  Group,
  Panel,
  Separator,
  useDefaultLayout,
  useGroupRef,
  usePanelRef,
} from 'react-resizable-panels';
import { useLayoutStore } from '../stores/layout';
import {
  type Arrangement,
  type Edge,
  type PanelKey,
  arrangementFor,
  edgeAt,
  isOutsideWindow,
  otherPanel,
} from './arrangement';

/** 패널을 끌 때 다른 드래그(파일, 목록 순서)와 구분하는 데이터 형식 */
const PANEL_TYPE = 'application/x-metacode-panel';

const LABEL: Record<PanelKey, string> = { chat: '채팅', plaza: '광장' };

/** 저장소를 쓸 수 없는 환경(사생활 보호 모드 등)이면 크기를 기억하지 않을 뿐이다 */
const layoutStorage: LayoutStorage = {
  getItem: (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // 무시
    }
  },
};

/** 패널 머리글에 넣을 것: 보기 전환 버튼(이 패널이 맡지 않으면 null), 옮기기·분리 손잡이 */
export interface PanelSlots {
  actions: ReactNode;
  handle: ReactNode;
}

interface SplitViewProps {
  chat: (slots: PanelSlots) => ReactNode;
  plaza: (slots: PanelSlots) => ReactNode;
  /** 새 창으로 분리할 때 열 주소 (/popout/...) */
  popoutPaths: Record<PanelKey, string>;
}

/**
 * 분할 화면: 지금 보는 채널의 채팅 모드와 그 광장.
 * - 가운데 선을 끌어 크기를 바꾸고, 머리글의 버튼으로 패널을 켜고 끈다.
 * - 머리글의 ⠿를 끌어 영역의 가장자리(상하좌우)에 놓으면 그쪽으로 옮기고, 창 밖에 놓으면(또는 ⧉) 새 창으로 분리한다.
 * - 크기, 켜짐, 배치는 기억한다. 분리한 창을 닫으면 메인 창으로 돌아온다.
 */
export function SplitView({ chat, plaza, popoutPaths }: SplitViewProps) {
  const arrangement = useLayoutStore((s) => s.arrangement);
  const detached = useLayoutStore((s) => s.detached);
  const [notice, setNotice] = useState<string | null>(null);
  const render = { chat, plaza };

  const detach = (key: PanelKey, at?: { x: number; y: number }) => {
    const ok = useLayoutStore.getState().detach(key, popoutPaths[key], at);
    setNotice(ok ? null : '브라우저가 새 창을 막았습니다. ⧉ 버튼을 눌러 다시 시도해 주세요.');
  };

  // 한쪽을 분리했으면 메인 창에는 다른 쪽만 보여 준다 (마지막 패널은 분리하지 않는다).
  const alone: PanelKey | null = detached.chat ? 'plaza' : detached.plaza ? 'chat' : null;
  if (alone) {
    return (
      <div className="split split--single">
        {render[alone]({ actions: <ReattachButton panel={otherPanel(alone)} />, handle: null })}
      </div>
    );
  }

  return (
    <>
      <SplitPanels
        // 배치가 바뀌면 패널 순서와 방향이 달라지므로 새로 그린다.
        key={`${arrangement.orientation}-${arrangement.first}`}
        arrangement={arrangement}
        render={render}
        onDetach={detach}
      />
      {notice && (
        <p className="split__notice" role="alert">
          {notice}
          <button
            type="button"
            className="icon-button"
            onClick={() => setNotice(null)}
            aria-label="닫기"
          >
            ×
          </button>
        </p>
      )}
    </>
  );
}

function SplitPanels({
  arrangement,
  render,
  onDetach,
}: {
  arrangement: Arrangement;
  render: Record<PanelKey, (slots: PanelSlots) => ReactNode>;
  onDetach(key: PanelKey, at?: { x: number; y: number }): void;
}) {
  const { orientation, first } = arrangement;
  const second = otherPanel(first);
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: `metacode-split-${orientation}`,
    storage: layoutStorage,
  });
  const groupRef = useGroupRef();
  const chatRef = usePanelRef();
  const plazaRef = usePanelRef();
  const refs = { chat: chatRef, plaza: plazaRef };
  const [open, setOpen] = useState<Record<PanelKey, boolean>>({
    chat: defaultLayout?.chat !== 0,
    plaza: defaultLayout?.plaza !== 0,
  });
  const [dragging, setDragging] = useState<PanelKey | null>(null);

  const track = (key: PanelKey) => (size: { asPercentage: number }) =>
    setOpen((current) => {
      const isOpen = size.asPercentage > 0;
      return current[key] === isOpen ? current : { ...current, [key]: isOpen };
    });

  const toggle = (key: PanelKey) => {
    const ref = refs[key];
    if (open[key]) return ref.current?.collapse();
    ref.current?.expand();
    // 창이 좁아 두 패널의 최소 크기가 함께 들어가지 않으면, 다른 패널을 닫고 바꿔 보여 준다.
    if (ref.current?.isCollapsed()) {
      groupRef.current?.setLayout({ [key]: 100, [otherPanel(key)]: 0 });
    }
  };

  const toggles = (
    <div className="view-toggles" role="group" aria-label="보기">
      {(['chat', 'plaza'] as const).map((key) => (
        <button
          key={key}
          type="button"
          className="view-toggles__button"
          aria-pressed={open[key]}
          // 둘 다 닫을 수는 없다.
          disabled={open[key] && !open[otherPanel(key)]}
          title={`${LABEL[key]} ${open[key] ? '닫기' : '열기'}`}
          onClick={() => toggle(key)}
        >
          {LABEL[key]}
        </button>
      ))}
    </div>
  );

  // 보기 전환 버튼은 보이는 첫 패널의 머리글에 둔다.
  const togglesOwner: PanelKey = open[first] ? first : second;
  const slots = (key: PanelKey): PanelSlots => ({
    actions: togglesOwner === key ? toggles : null,
    handle: (
      <PanelHandle
        panel={key}
        onDragChange={setDragging}
        // 다른 패널이 닫혀 있으면 메인 창이 비므로 분리하지 않는다.
        onDetach={open[otherPanel(key)] ? (at) => onDetach(key, at) : undefined}
      />
    ),
  });

  const panel = (key: PanelKey) => (
    <Panel
      id={key}
      className="split__panel"
      panelRef={refs[key]}
      collapsible
      minSize={key === 'chat' ? 300 : 240}
      defaultSize={key === 'chat' ? '55' : '45'}
      onResize={track(key)}
    >
      {key === 'chat' ? (
        // 닫힌 채팅은 입력 중이던 글을 잃지 않도록 그대로 둔다.
        <div className="split__content" inert={!open.chat}>
          {render.chat(slots('chat'))}
        </div>
      ) : (
        // 닫힌 광장은 내려서 서버 구독과 그리기를 멈춘다.
        <div className="split__content">{open.plaza && render.plaza(slots('plaza'))}</div>
      )}
    </Panel>
  );

  return (
    <div className="split-host">
      <Group
        className="split"
        orientation={orientation}
        id={`metacode-split-${orientation}`}
        groupRef={groupRef}
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
      >
        {panel(first)}
        <Separator className="split__separator" />
        {panel(second)}
      </Group>
      {dragging && <DropZones dragged={dragging} onDone={() => setDragging(null)} />}
    </div>
  );
}

/** 패널 손잡이: ⠿를 끌어 옮기고(창 밖에 놓으면 분리), ⧉를 누르면 새 창으로 분리한다 */
function PanelHandle({
  panel,
  onDragChange,
  onDetach,
}: {
  panel: PanelKey;
  onDragChange(panel: PanelKey | null): void;
  onDetach?: (at?: { x: number; y: number }) => void;
}) {
  const onDragEnd = (e: DragEvent) => {
    onDragChange(null);
    const outside = isOutsideWindow(
      { x: e.screenX, y: e.screenY },
      {
        x: window.screenX,
        y: window.screenY,
        width: window.outerWidth,
        height: window.outerHeight,
      },
    );
    // 아무 데도 놓지 않았고(dropEffect none) 창 밖이면 분리한다.
    if (onDetach && e.dataTransfer.dropEffect === 'none' && outside) {
      onDetach({ x: e.screenX, y: e.screenY });
    }
  };

  return (
    <span className="panel-handle">
      <span
        className="panel-handle__grip"
        draggable
        role="button"
        aria-label={`${LABEL[panel]} 옮기기`}
        title="끌어서 상하좌우로 옮기기 · 창 밖에 놓으면 새 창으로 분리"
        onDragStart={(e) => {
          e.dataTransfer.setData(PANEL_TYPE, panel);
          e.dataTransfer.effectAllowed = 'move';
          onDragChange(panel);
        }}
        onDragEnd={onDragEnd}
      >
        ⠿
      </span>
      {onDetach && (
        <button
          type="button"
          className="icon-button panel-handle__popout"
          onClick={() => onDetach()}
          aria-label={`${LABEL[panel]} 새 창으로 분리`}
          title="새 창으로 분리"
        >
          ⧉
        </button>
      )}
    </span>
  );
}

/** 패널을 끄는 동안 분할 영역 위에 뜨는 놓을 자리. 가장 가까운 가장자리 쪽 절반을 미리 보여 준다 */
function DropZones({ dragged, onDone }: { dragged: PanelKey; onDone(): void }) {
  const [edge, setEdge] = useState<Edge | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(PANEL_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = ref.current!.getBoundingClientRect();
    const next = edgeAt(rect, e.clientX, e.clientY);
    if (next !== edge) setEdge(next);
  };

  const onDrop = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(PANEL_TYPE) || !edge) return;
    e.preventDefault();
    useLayoutStore.getState().setArrangement(arrangementFor(dragged, edge));
    onDone();
  };

  return (
    <div
      ref={ref}
      className="split-drop"
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setEdge(null);
      }}
      onDrop={onDrop}
    >
      {edge && (
        <div className="split-drop__preview" data-edge={edge}>
          {LABEL[dragged]}
        </div>
      )}
    </div>
  );
}

/** 분리한 패널을 메인 창으로 돌려놓기 */
function ReattachButton({ panel }: { panel: PanelKey }) {
  return (
    <button
      type="button"
      className="view-toggles__button view-toggles__button--solo"
      onClick={() => useLayoutStore.getState().reattach(panel)}
      title={`분리한 ${LABEL[panel]} 창을 닫고 여기로 돌려놓기`}
    >
      {LABEL[panel]} 돌려놓기
    </button>
  );
}
