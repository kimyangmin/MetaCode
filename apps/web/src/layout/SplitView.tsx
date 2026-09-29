import { type DragEvent, type ReactNode, useEffect, useRef, useState } from 'react';
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
  PANEL_FOCUS_EVENT,
  type PanelFocusRequest,
  RETURN_FOCUS_ATTR,
  ownsFocus,
  panelFocusTarget,
} from './panelFocus';
import {
  type Arrangement,
  type Edge,
  type PanelKey,
  arrangementFor,
  edgeAt,
  isOutsideWindow,
  otherPanel,
} from './arrangement';
import { GripVertical, SquareArrowOutUpRight, X } from 'lucide-react';
import { useIsPhone } from '../ui/useMediaQuery';
import { isAndroidApp } from '../platform';
import { NavButton } from './NavButton';

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
  const phone = useIsPhone();
  const render = { chat, plaza };

  // 휴대폰 화면은 나란히 놓을 자리가 없으므로 하나씩 바꿔 보여 준다 (옮기기·분리 없음).
  if (phone) return <PhoneSplit render={render} />;

  const detach = (key: PanelKey, at?: { x: number; y: number }) => {
    const ok = useLayoutStore.getState().detach(key, popoutPaths[key], at);
    setNotice(
      ok ? null : '브라우저가 새 창을 막았습니다. 새 창으로 분리 버튼을 눌러 다시 시도해 주세요.',
    );
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
            <X aria-hidden />
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
  const hostRef = useRef<HTMLDivElement>(null);
  // 끌고 있는 패널. 드래그를 시작할 때 화면을 바꾸지 않도록 상태가 아니라 ref에 둔다 (onDragStart 설명).
  const dragged = useRef<PanelKey | null>(null);
  const [drop, setDrop] = useState<{ panel: PanelKey; edge: Edge } | null>(null);

  const edgeOf = (e: DragEvent) =>
    edgeAt(hostRef.current!.getBoundingClientRect(), e.clientX, e.clientY);

  // 놓을 자리는 분할 영역 전체다. 안쪽 요소의 dragover가 올라오므로 따로 덮개를 두지 않는다.
  const onDragOver = (e: DragEvent) => {
    const panel = dragged.current;
    if (!panel || !e.dataTransfer.types.includes(PANEL_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const edge = edgeOf(e);
    if (drop?.panel !== panel || drop.edge !== edge) setDrop({ panel, edge });
  };

  const onDrop = (e: DragEvent) => {
    const panel = dragged.current;
    if (!panel || !e.dataTransfer.types.includes(PANEL_TYPE)) return;
    e.preventDefault();
    useLayoutStore.getState().setArrangement(arrangementFor(panel, edgeOf(e)));
    setDrop(null);
  };

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

  // 패널에 포커스 주기: 접혀 있으면 펼치고, 그려질 때까지 몇 프레임 기다린다 (광장은 펼칠 때 새로 뜬다).
  const focusPanel = (key: PanelKey, returnTo?: PanelKey) => {
    const host = hostRef.current;
    if (!host) return;
    if (!open[key]) toggle(key);
    let tries = 0;
    const attempt = () => {
      const target = panelFocusTarget(host, key);
      if (target) {
        target.focus({ preventScroll: true });
        if (returnTo) target.setAttribute(RETURN_FOCUS_ATTR, returnTo);
      } else if (tries++ < 90) requestAnimationFrame(attempt);
    };
    attempt();
  };

  // Shift+Tab: 광장 ↔ 채팅 입력창. 광장의 /는 PlazaView가 requestPanelFocus('chat')로 알린다.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
      if (!ownsFocus(host, document.activeElement)) return;
      e.preventDefault();
      const inPlaza = !!document.activeElement?.closest('[data-panel="plaza"]');
      focusPanel(inPlaza ? 'chat' : 'plaza');
    };
    const onRequest = (e: Event) => {
      const { panel, returnTo } = (e as CustomEvent<PanelFocusRequest>).detail;
      focusPanel(panel, returnTo);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener(PANEL_FOCUS_EVENT, onRequest);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener(PANEL_FOCUS_EVENT, onRequest);
    };
  });

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
        onDragChange={(panel) => {
          dragged.current = panel;
          if (!panel) setDrop(null);
        }}
        // 다른 패널이 닫혀 있으면 메인 창이 비므로 분리하지 않는다. 안드로이드 앱은 새 창을 열 수 없다.
        onDetach={open[otherPanel(key)] && !isAndroidApp() ? (at) => onDetach(key, at) : undefined}
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
        <div className="split__content" data-panel="chat" inert={!open.chat}>
          {render.chat(slots('chat'))}
        </div>
      ) : (
        // 닫힌 광장은 내려서 서버 구독과 그리기를 멈춘다.
        <div className="split__content" data-panel="plaza">
          {open.plaza && render.plaza(slots('plaza'))}
        </div>
      )}
    </Panel>
  );

  return (
    <div
      ref={hostRef}
      className="split-host"
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null);
      }}
      onDrop={onDrop}
    >
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
      {drop && (
        <div className="split-drop__preview" data-edge={drop.edge}>
          {LABEL[drop.panel]}
        </div>
      )}
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
  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData(PANEL_TYPE, panel);
    e.dataTransfer.effectAllowed = 'move';
    // 여기서는 화면을 바꾸지 않는다. Chromium은 dragstart 직후 누른 자리에 끄는 요소가 그대로 있는지
    // 확인하고, 다른 요소(예: 놓을 자리 덮개)가 가리면 드래그를 바로 취소한다 (실제로 그래서 끌리지 않았음).
    onDragChange(panel);
  };

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
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <GripVertical aria-hidden />
      </span>
      {onDetach && (
        <button
          type="button"
          className="icon-button panel-handle__popout"
          onClick={() => onDetach()}
          aria-label={`${LABEL[panel]} 새 창으로 분리`}
          title="새 창으로 분리"
        >
          <SquareArrowOutUpRight aria-hidden />
        </button>
      )}
    </span>
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

/**
 * 휴대폰 화면: 채팅과 광장을 머리글의 버튼으로 바꿔 가며 하나씩 보여 준다.
 * 채팅은 쓰던 글이 남도록 숨기기만 하고, 광장은 보지 않을 때 내려서 그리기와 구독을 멈춘다.
 * /(광장 → 입력창)와 보낸 뒤 돌아가기 같은 포커스 요청도 보이는 패널을 바꿔 처리한다.
 */
function PhoneSplit({ render }: { render: Record<PanelKey, (slots: PanelSlots) => ReactNode> }) {
  const [active, setActive] = useState<PanelKey>('chat');
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onRequest = (e: Event) => {
      const { panel, returnTo } = (e as CustomEvent<PanelFocusRequest>).detail;
      setActive(panel);
      let tries = 0;
      const attempt = () => {
        const target = hostRef.current && panelFocusTarget(hostRef.current, panel);
        if (target) {
          target.focus({ preventScroll: true });
          if (returnTo) target.setAttribute(RETURN_FOCUS_ATTR, returnTo);
        } else if (tries++ < 90) requestAnimationFrame(attempt);
      };
      requestAnimationFrame(attempt);
    };
    window.addEventListener(PANEL_FOCUS_EVENT, onRequest);
    return () => window.removeEventListener(PANEL_FOCUS_EVENT, onRequest);
  }, []);

  const toggles = (
    <div className="view-toggles" role="group" aria-label="보기">
      {(['chat', 'plaza'] as const).map((key) => (
        <button
          key={key}
          type="button"
          className="view-toggles__button"
          aria-pressed={active === key}
          onClick={() => setActive(key)}
        >
          {LABEL[key]}
        </button>
      ))}
    </div>
  );
  const slots: PanelSlots = { actions: toggles, handle: <NavButton /> };

  return (
    <div ref={hostRef} className="split split--phone">
      <div
        className="split__content"
        data-panel="chat"
        hidden={active !== 'chat'}
        inert={active !== 'chat'}
      >
        {render.chat(slots)}
      </div>
      {active === 'plaza' && (
        <div className="split__content" data-panel="plaza">
          {render.plaza(slots)}
        </div>
      )}
    </div>
  );
}
