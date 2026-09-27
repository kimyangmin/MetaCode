// 작은 파일은 Vite가 data: 주소로 넣는데, AudioWorklet 모듈은 파일 주소로 불러오게 한다.
import workletUrl from './micLevel.worklet.js?url&no-inline';

export type LevelListener = (levelDb: number, timeMs: number) => void;

/**
 * 마이크 트랙의 음량을 잰다 (WebAudio AudioWorklet). 소리를 바꾸지 않고 옆에서 재기만 하므로
 * 보내는 음성에는 영향이 없다. 재는 대상은 실제로 보내는 트랙(잡음 억제, 마이크 증폭을 거친 뒤)이다.
 */
export class MicLevelMeter {
  private source: MediaStreamAudioSourceNode | null = null;
  private attached: MediaStreamTrack | null = null;

  private constructor(
    private readonly context: AudioContext,
    private readonly node: AudioWorkletNode,
    private readonly sink: GainNode,
  ) {}

  /** AudioWorklet을 쓸 수 없는 환경이면 실패한다 */
  static async create(context: AudioContext, onLevel: LevelListener): Promise<MicLevelMeter> {
    await context.audioWorklet.addModule(workletUrl);
    const node = new AudioWorkletNode(context, 'metacode-level-meter');
    node.port.onmessage = ({ data }: MessageEvent<{ level: number; time: number }>) =>
      onLevel(data.level, data.time);
    // 출력으로 이어져 있어야 처리되는 브라우저가 있어서, 소리가 나지 않게 0으로 줄여 잇는다.
    const sink = context.createGain();
    sink.gain.value = 0;
    node.connect(sink).connect(context.destination);
    return new MicLevelMeter(context, node, sink);
  }

  get track(): MediaStreamTrack | null {
    return this.attached;
  }

  /** 이 트랙을 잰다 (앞의 트랙은 뗀다) */
  attach(track: MediaStreamTrack): void {
    if (this.attached === track) return;
    this.detach();
    this.source = this.context.createMediaStreamSource(new MediaStream([track]));
    this.source.connect(this.node);
    this.attached = track;
  }

  detach(): void {
    this.source?.disconnect();
    this.source = null;
    this.attached = null;
  }

  dispose(): void {
    this.detach();
    this.node.port.onmessage = null;
    this.node.disconnect();
    this.sink.disconnect();
  }
}
