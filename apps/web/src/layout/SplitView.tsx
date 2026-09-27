import { type ReactNode, useState } from 'react';
import {
  type LayoutStorage,
  Group,
  Panel,
  Separator,
  useDefaultLayout,
  useGroupRef,
  usePanelRef,
} from 'react-resizable-panels';

type PanelKey = 'chat' | 'plaza';

const other = (key: PanelKey): PanelKey => (key === 'chat' ? 'plaza' : 'chat');

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

interface SplitViewProps {
  /** 채팅 모드. 인자는 머리글에 넣을 보기 전환 버튼 (이 패널이 맡지 않으면 null) */
  chat: (actions: ReactNode) => ReactNode;
  plaza: (actions: ReactNode) => ReactNode;
}

/**
 * 분할 화면: 지금 보는 채널의 채팅 모드 | 그 광장. 가운데 선을 끌어 크기를 바꾸고,
 * 머리글의 버튼으로 패널을 켜고 끈다. 크기와 켜짐 상태는 기억한다.
 * 닫힌 채팅은 입력 중이던 글을 잃지 않도록 그대로 두고, 닫힌 광장은 내려서 서버 구독과 그리기를 멈춘다.
 */
export function SplitView({ chat, plaza }: SplitViewProps) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'metacode-split',
    storage: layoutStorage,
  });
  const groupRef = useGroupRef();
  const chatRef = usePanelRef();
  const plazaRef = usePanelRef();
  const [open, setOpen] = useState<Record<PanelKey, boolean>>({
    chat: defaultLayout?.chat !== 0,
    plaza: defaultLayout?.plaza !== 0,
  });

  const track = (key: PanelKey) => (size: { asPercentage: number }) =>
    setOpen((current) => {
      const isOpen = size.asPercentage > 0;
      return current[key] === isOpen ? current : { ...current, [key]: isOpen };
    });

  const toggle = (key: PanelKey) => {
    const ref = key === 'chat' ? chatRef : plazaRef;
    if (open[key]) return ref.current?.collapse();
    ref.current?.expand();
    // 창이 좁아 두 패널의 최소 크기가 함께 들어가지 않으면, 다른 패널을 닫고 바꿔 보여 준다.
    if (ref.current?.isCollapsed()) {
      groupRef.current?.setLayout({ [key]: 100, [other(key)]: 0 });
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
          disabled={open[key] && !open[other(key)]}
          title={`${key === 'chat' ? '채팅' : '광장'} ${open[key] ? '닫기' : '열기'}`}
          onClick={() => toggle(key)}
        >
          {key === 'chat' ? '채팅' : '광장'}
        </button>
      ))}
    </div>
  );

  return (
    <Group
      className="split"
      orientation="horizontal"
      id="metacode-split"
      groupRef={groupRef}
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
    >
      <Panel
        id="chat"
        className="split__panel"
        panelRef={chatRef}
        collapsible
        minSize={300}
        defaultSize="55"
        onResize={track('chat')}
      >
        <div className="split__content" inert={!open.chat}>
          {chat(open.chat ? toggles : null)}
        </div>
      </Panel>
      <Separator className="split__separator" />
      <Panel
        id="plaza"
        className="split__panel"
        panelRef={plazaRef}
        collapsible
        minSize={240}
        defaultSize="45"
        onResize={track('plaza')}
      >
        <div className="split__content">{open.plaza && plaza(open.chat ? null : toggles)}</div>
      </Panel>
    </Group>
  );
}
