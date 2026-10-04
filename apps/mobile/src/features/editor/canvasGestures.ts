import { type ComposedGesture, Gesture } from 'react-native-gesture-handler';

export type Stroke = (phase: 'start' | 'move' | 'end', x: number, y: number) => void;
export type CanvasView = {
  left: number;
  top: number;
  cell: number;
  zoom: number;
  pan: { x: number; y: number };
};

/**
 * 그림판의 제스처(한 손가락 칠하기, 두 손가락 확대·이동)와 그 제스처가 읽는 지금 값. 도트 에디터와 맵 에디터가 함께 쓴다.
 * 칠하기는 칸 좌표로 넘긴다: 칸 = floor((손가락 - 그림 왼쪽 위) / 칸 크기). 확대 범위는 maxZoom까지.
 * 제스처 객체는 처음 한 번만 만든다: 칠할 때마다 그림판이 다시 그려지는데, 제스처 객체가 바뀌면 손가락을 댄 채로
 * 제스처가 다시 붙으면서 붓질이 끊겼다 (세로로 길게 그으면 첫 점만 찍혔음). 지금 값은 렌더가 끝난 뒤 `sync`로
 * 넘겨받는다 (React Compiler 린트가 렌더 중 ref 접근을 막으므로, 광장의 PlazaEngine처럼 클래스에 둠).
 */
export class CanvasGestures {
  readonly gesture: ComposedGesture;
  private view: CanvasView = { left: 0, top: 0, cell: 1, zoom: 1, pan: { x: 0, y: 0 } };
  private onStroke: Stroke = () => {};
  private setZoom: (zoom: number) => void = () => {};
  private setPan: (pan: { x: number; y: number }) => void = () => {};
  /** 두 손가락을 댄 순간의 확대·위치 */
  private start: { zoom: number; pan: { x: number; y: number } } | null = null;

  constructor(private readonly maxZoom = 16) {
    // 제스처 콜백은 Reanimated Babel 플러그인이 worklet으로 바꿔 `this`를 잃는다 (광장처럼 지역 변수로 잡는다)
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const draw = Gesture.Pan()
      .runOnJS(true)
      .minDistance(0)
      .maxPointers(1)
      .onBegin((e) => self.stroke('start', e.x, e.y))
      .onUpdate((e) => self.stroke('move', e.x, e.y))
      .onFinalize((e) => self.stroke('end', e.x, e.y));
    const pinch = Gesture.Pinch()
      .runOnJS(true)
      .onBegin(() => self.pinchBegin())
      .onUpdate((e) => self.pinchUpdate(e.scale))
      .onFinalize(() => self.pinchEnd());
    const move = Gesture.Pan()
      .runOnJS(true)
      .minPointers(2)
      .onUpdate((e) => self.moveUpdate(e.translationX, e.translationY));
    this.gesture = Gesture.Race(Gesture.Simultaneous(pinch, move), draw);
  }

  sync(
    view: CanvasView,
    onStroke: Stroke,
    setZoom: (zoom: number) => void,
    setPan: (pan: { x: number; y: number }) => void,
  ): void {
    this.view = view;
    this.onStroke = onStroke;
    this.setZoom = setZoom;
    this.setPan = setPan;
  }

  private stroke(phase: 'start' | 'move' | 'end', x: number, y: number): void {
    const v = this.view;
    this.onStroke(phase, Math.floor((x - v.left) / v.cell), Math.floor((y - v.top) / v.cell));
  }

  private pinchBegin(): void {
    this.start = { zoom: this.view.zoom, pan: this.view.pan };
  }

  private pinchUpdate(scale: number): void {
    if (this.start) this.setZoom(Math.min(this.maxZoom, Math.max(1, this.start.zoom * scale)));
  }

  private pinchEnd(): void {
    this.start = null;
  }

  private moveUpdate(dx: number, dy: number): void {
    if (this.start) this.setPan({ x: this.start.pan.x + dx, y: this.start.pan.y + dy });
  }
}
