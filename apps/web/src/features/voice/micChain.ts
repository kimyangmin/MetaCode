import type { AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client';
import { DEFAULT_SENSITIVITY, type Sensitivity } from './gate';
import type { GateMessage } from './micGate.worklet';
// 문턱 처리기는 gate.ts와 함께 따로 묶은 파일 주소로 불러온다 (AudioWorklet은 주소로만 불러올 수 있다).
import gateWorkletUrl from './micGate.worklet.ts?worker&url';

/** 마이크 처리 설정 (설정 창에서 바꾸고 기억한다) */
export interface MicSettings {
  /** RNNoise 잡음 제거. 끄면 브라우저 기본 잡음 억제를 쓴다 */
  noiseSuppression: boolean;
  /** 마이크 증폭 (1이 원래 크기) */
  gain: number;
  sensitivity: Sensitivity;
}

export const DEFAULT_MIC_SETTINGS: MicSettings = {
  noiseSuppression: true,
  gain: 1,
  sensitivity: DEFAULT_SENSITIVITY,
};

/** RNNoise는 48kHz로 처리하므로 마이크 처리용 AudioContext는 48kHz로 만든다 */
export const MIC_SAMPLE_RATE = 48_000;

/** 브라우저에 줄 마이크 조건. RNNoise를 쓰면 브라우저 잡음 억제는 끈다 (두 번 거르면 목소리가 뭉개짐) */
export function captureConstraints(settings: Pick<MicSettings, 'noiseSuppression'>) {
  return {
    echoCancellation: true,
    autoGainControl: true,
    noiseSuppression: !settings.noiseSuppression,
  };
}

// ── 잡음 제거(RNNoise)는 켰을 때 처음 한 번만 받는다 (WASM 약 150KB) ──

type RnnoiseModule = typeof import('@sapphi-red/web-noise-suppressor');
let rnnoise: Promise<{ module: RnnoiseModule; wasm: ArrayBuffer; workletUrl: string }> | null =
  null;

function loadRnnoiseAssets() {
  rnnoise ??= (async () => {
    const [module, worklet, wasm, simd] = await Promise.all([
      import('@sapphi-red/web-noise-suppressor'),
      import('@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url'),
      import('@sapphi-red/web-noise-suppressor/rnnoise.wasm?url'),
      import('@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url'),
    ]);
    const binary = await module.loadRnnoise({ url: wasm.default, simdUrl: simd.default });
    return { module, wasm: binary, workletUrl: worklet.default };
  })();
  // 실패하면 다음에 다시 시도할 수 있게 비운다.
  rnnoise.catch(() => {
    rnnoise = null;
  });
  return rnnoise;
}

/** AudioContext마다 처리기 모듈은 한 번만 올린다 */
const loadedModules = new WeakMap<AudioContext, Map<string, Promise<void>>>();
function addModule(context: AudioContext, url: string): Promise<void> {
  let modules = loadedModules.get(context);
  if (!modules) loadedModules.set(context, (modules = new Map()));
  let loading = modules.get(url);
  if (!loading) {
    loading = context.audioWorklet.addModule(url);
    modules.set(url, loading);
    loading.catch(() => modules.delete(url));
  }
  return loading;
}

/**
 * 마이크 처리 줄: 마이크 → (RNNoise 잡음 제거) → 소리 문턱 + 음량 측정 → 증폭 → 내보내는 트랙.
 * 통화(MicProcessor)와 설정 창의 마이크 시험(MicPreview)이 같은 줄을 쓴다.
 * RNNoise를 불러오지 못하면(오래된 브라우저 등) 잡음 제거 없이 이어 간다.
 */
export class MicChain {
  private source: MediaStreamAudioSourceNode | null = null;
  private denoiser: AudioWorkletNode | null = null;
  private readonly destination: MediaStreamAudioDestinationNode;
  private readonly amplifier: GainNode;
  private readonly sink: GainNode;
  /** RNNoise를 켜려 했지만 불러오지 못했다 */
  denoiseFailed = false;

  private constructor(
    private readonly context: AudioContext,
    private readonly gate: AudioWorkletNode,
    private settings: MicSettings,
  ) {
    this.amplifier = context.createGain();
    this.amplifier.gain.value = settings.gain;
    this.destination = context.createMediaStreamDestination();
    // 어떤 브라우저는 출력으로 이어진 노드만 처리한다. 소리가 나지 않게 0으로 줄여 스피커에도 잇는다.
    this.sink = context.createGain();
    this.sink.gain.value = 0;
    gate.connect(this.amplifier).connect(this.destination);
    this.amplifier.connect(this.sink).connect(context.destination);
    this.gate.port.postMessage({
      sensitivity: settings.sensitivity,
      voiceOnly: settings.noiseSuppression,
    });
  }

  /** AudioWorklet을 쓸 수 없으면 실패한다 */
  static async create(
    context: AudioContext,
    settings: MicSettings,
    onReport: (message: GateMessage) => void,
  ): Promise<MicChain> {
    await addModule(context, gateWorkletUrl);
    const gate = new AudioWorkletNode(context, 'metacode-mic-gate', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: 'explicit',
    });
    gate.port.onmessage = ({ data }: MessageEvent<GateMessage>) => onReport(data);
    return new MicChain(context, gate, { ...settings });
  }

  /** 처리한 소리 (보낼 트랙) */
  get output(): MediaStreamTrack {
    return this.destination.stream.getAudioTracks()[0]!;
  }

  /** 이 마이크 트랙을 처리한다 (앞의 트랙은 뗀다) */
  async attach(track: MediaStreamTrack): Promise<MediaStreamTrack> {
    this.source?.disconnect();
    this.source = this.context.createMediaStreamSource(new MediaStream([track]));
    await this.wire();
    return this.output;
  }

  setGain(value: number): void {
    this.settings.gain = value;
    this.amplifier.gain.value = value;
  }

  setSensitivity(sensitivity: Sensitivity): void {
    this.settings.sensitivity = sensitivity;
    this.gate.port.postMessage({ sensitivity });
  }

  async setNoiseSuppression(on: boolean): Promise<void> {
    if (this.settings.noiseSuppression === on) return;
    this.settings.noiseSuppression = on;
    // 잡음 제거를 켜면 문턱도 목소리만 통과시킨다 (숨소리·씹는 소리는 RNNoise가 남기므로).
    this.gate.port.postMessage({ voiceOnly: on });
    await this.wire();
  }

  get denoising(): boolean {
    return !!this.denoiser;
  }

  /** 마이크 → (잡음 제거) → 문턱 순서로 다시 잇는다 */
  private async wire(): Promise<void> {
    const source = this.source;
    if (!source) return;
    const wantDenoise = this.settings.noiseSuppression;
    if (wantDenoise && !this.denoiser) this.denoiser = await this.createDenoiser();
    if (!wantDenoise && this.denoiser) {
      this.denoiser.disconnect();
      (this.denoiser as AudioWorkletNode & { destroy?: () => void }).destroy?.();
      this.denoiser = null;
    }
    // 불러오는 사이 다른 트랙으로 바뀌었으면 그쪽이 다시 잇는다.
    if (this.source !== source) return;
    source.disconnect();
    this.denoiser?.disconnect();
    if (this.denoiser) source.connect(this.denoiser).connect(this.gate);
    else source.connect(this.gate);
  }

  private async createDenoiser(): Promise<AudioWorkletNode | null> {
    if (this.context.sampleRate !== MIC_SAMPLE_RATE) {
      this.denoiseFailed = true;
      return null;
    }
    try {
      const { module, wasm, workletUrl } = await loadRnnoiseAssets();
      await addModule(this.context, workletUrl);
      this.denoiseFailed = false;
      return new module.RnnoiseWorkletNode(this.context, { wasmBinary: wasm, maxChannels: 1 });
    } catch {
      this.denoiseFailed = true;
      return null;
    }
  }

  dispose(): void {
    this.source?.disconnect();
    this.source = null;
    if (this.denoiser) {
      this.denoiser.disconnect();
      (this.denoiser as AudioWorkletNode & { destroy?: () => void }).destroy?.();
      this.denoiser = null;
    }
    this.gate.port.onmessage = null;
    this.gate.disconnect();
    this.amplifier.disconnect();
    this.sink.disconnect();
    this.destination.stream.getTracks().forEach((t) => t.stop());
  }
}

/**
 * 통화에서 쓰는 LiveKit 오디오 처리기. LiveKit이 보내기 전에 마이크 트랙을 이 줄로 거친다.
 * 장치를 바꾸거나 마이크 조건을 바꾸면 LiveKit이 restart로 새 트랙을 넘긴다.
 */
export class MicProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = 'metacode-mic';
  processedTrack?: MediaStreamTrack;
  private chain: MicChain | null = null;

  constructor(
    private settings: MicSettings,
    private readonly onReport: (message: GateMessage) => void,
  ) {}

  async init({ track, audioContext }: AudioProcessorOptions): Promise<void> {
    if (audioContext.state === 'suspended') await audioContext.resume().catch(() => {});
    this.chain = await MicChain.create(audioContext, this.settings, this.onReport);
    this.processedTrack = await this.chain.attach(track);
  }

  async restart(options: AudioProcessorOptions): Promise<void> {
    await this.destroy();
    await this.init(options);
  }

  async destroy(): Promise<void> {
    this.chain?.dispose();
    this.chain = null;
    this.processedTrack = undefined;
  }

  setGain(value: number): void {
    this.settings = { ...this.settings, gain: value };
    this.chain?.setGain(value);
  }

  setSensitivity(sensitivity: Sensitivity): void {
    this.settings = { ...this.settings, sensitivity };
    this.chain?.setSensitivity(sensitivity);
  }

  async setNoiseSuppression(on: boolean): Promise<void> {
    this.settings = { ...this.settings, noiseSuppression: on };
    await this.chain?.setNoiseSuppression(on);
  }

  get denoiseFailed(): boolean {
    return this.chain?.denoiseFailed ?? false;
  }
}

// ── 입력 감도 막대에 보여 줄 음량 (초당 50번이라 상태 저장소가 아니라 직접 구독) ──

type ReportListener = (message: GateMessage) => void;
const reportListeners = new Set<ReportListener>();

export const micReports = {
  publish(message: GateMessage): void {
    for (const listener of reportListeners) listener(message);
  },
  subscribe(listener: ReportListener): () => void {
    reportListeners.add(listener);
    return () => reportListeners.delete(listener);
  },
};

/**
 * 마이크 시험 (설정 창): 통화 중이 아닐 때 같은 처리 줄로 마이크를 재서 막대에 보여 준다.
 * 보내지도, 스피커로 틀지도 않는다.
 */
export class MicPreview {
  private constructor(
    private readonly context: AudioContext,
    private readonly stream: MediaStream,
    private readonly chain: MicChain,
  ) {}

  static async start(settings: MicSettings, deviceId: string | null): Promise<MicPreview> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { ideal: deviceId } } : {}),
        ...captureConstraints(settings),
      },
    });
    const context = new AudioContext({ sampleRate: MIC_SAMPLE_RATE });
    try {
      if (context.state === 'suspended') await context.resume().catch(() => {});
      const chain = await MicChain.create(context, settings, (m) => micReports.publish(m));
      await chain.attach(stream.getAudioTracks()[0]!);
      return new MicPreview(context, stream, chain);
    } catch (error) {
      stream.getTracks().forEach((t) => t.stop());
      void context.close().catch(() => {});
      throw error;
    }
  }

  setSensitivity(sensitivity: Sensitivity): void {
    this.chain.setSensitivity(sensitivity);
  }

  setGain(value: number): void {
    this.chain.setGain(value);
  }

  stop(): void {
    this.chain.dispose();
    this.stream.getTracks().forEach((t) => t.stop());
    void this.context.close().catch(() => {});
  }
}
