/**
 * 마이크 소리 문턱 + 음량 측정기 (AudioWorklet, 오디오 스레드).
 * - 문턱: 음량이 문턱을 넘으면 바로 열고, 조용해지면 잠시 뒤 부드럽게 닫는다 (gate.ts).
 *   오디오 스레드에서 판단해서 화면이 바쁘거나 창이 가려져도 첫소리가 잘리지 않는다.
 * - 잡음 제거를 켜면 목소리만 통과시킨다 (voiceActivity.ts): 음량이 커도 목소리(피치)가 없으면
 *   (콧바람, 씹는 소리) 열지 않고, 첫소리를 살리려고 소리를 40ms 늦게 내보낸다.
 * - 측정: 20ms마다 그 구간의 음량(문턱을 거치기 전, 잡음 제거는 거친 뒤)과 쓰고 있는 문턱을 알린다.
 *   말하는 중 표시와 입력 감도 막대가 이 값을 쓴다.
 * 번들러가 이 파일을 따로 묶어(?worker&url) gate.ts를 함께 넣는다.
 */
import {
  GATE_ATTACK_MS,
  GATE_RELEASE_MS,
  GateState,
  NoiseFloor,
  type Sensitivity,
  gainStep,
  toDb,
} from './gate';
import { DelayLine, VOICE_LOOKAHEAD_MS, VoiceGate, VoicingDetector } from './voiceActivity';

// AudioWorkletGlobalScope (DOM 타입에 없어서 필요한 만큼만 적는다)
declare const sampleRate: number;
declare const currentTime: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

export interface GateMessage {
  /** 20ms 구간의 음량 (dBFS) */
  level: number;
  /** 지금 쓰는 문턱 (dBFS) */
  threshold: number;
  /** 문턱이 열려 있는지 */
  open: boolean;
  /** 오디오 시각 (ms) */
  time: number;
}

const REPORT_SECONDS = 0.02;

class MicGate extends AudioWorkletProcessor {
  private sensitivity: Sensitivity = { mode: 'auto', thresholdDb: -50 };
  private readonly floor = new NoiseFloor();
  private readonly gate = new GateState();
  private gain = 0;
  private readonly attack = gainStep(GATE_ATTACK_MS, sampleRate);
  private readonly release = gainStep(GATE_RELEASE_MS, sampleRate);
  private readonly reportFrames = Math.round(sampleRate * REPORT_SECONDS);
  private sum = 0;
  private count = 0;
  /**
   * 목소리만 통과 (잡음 제거를 켰을 때, voiceActivity.ts): 음량과 함께 목소리인지도 보고, 첫소리가 잘리지
   * 않게 소리를 VOICE_LOOKAHEAD_MS 늦게 내보낸다. 끄면 음량만 보고 늦추지 않는다.
   */
  private voiceOnly = false;
  private readonly voicing = new VoicingDetector(sampleRate);
  private readonly voiceGate = new VoiceGate();
  private readonly delay = new DelayLine(Math.round((sampleRate * VOICE_LOOKAHEAD_MS) / 1000));

  constructor() {
    super();
    this.port.onmessage = ({
      data,
    }: MessageEvent<{ sensitivity?: Sensitivity; voiceOnly?: boolean }>) => {
      if (data.sensitivity) this.sensitivity = data.sensitivity;
      if (data.voiceOnly !== undefined) this.voiceOnly = data.voiceOnly;
    };
  }

  private threshold(): number {
    return this.sensitivity.mode === 'auto' ? this.floor.threshold() : this.sensitivity.thresholdDb;
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0] ?? [];
    const output = outputs[0] ?? [];
    const samples = input[0];
    const frames = output[0]?.length ?? 128;
    const threshold = this.threshold();

    // 이 묶음(128샘플, 약 2.7ms)의 음량으로 문턱을 판단한다.
    let quantumSum = 0;
    if (samples) for (let i = 0; i < samples.length; i++) quantumSum += samples[i]! * samples[i]!;
    const quantumDb = samples ? toDb(Math.sqrt(quantumSum / samples.length)) : -100;
    const now = currentTime * 1000;
    let open: boolean;
    if (this.voiceOnly) {
      if (samples) this.voicing.push(samples);
      open = this.voiceGate.push(quantumDb, threshold, this.voicing.voiced, now);
    } else {
      open = this.gate.push(quantumDb, threshold, now);
    }
    const target = open ? 1 : 0;

    // 소리 크기를 샘플마다 부드럽게 옮기며 곱한다. 보내는 소리는 한 채널이다 (outputChannelCount 1).
    for (let i = 0; i < frames; i++) {
      this.gain += (target - this.gain) * (target > this.gain ? this.attack : this.release);
      const sample = samples ? samples[i]! : 0;
      // 목소리만 통과일 때는 판단보다 늦은 소리를 내보내, 판단이 열리기 직전의 첫소리도 함께 나간다.
      const delayed = this.voiceOnly ? this.delay.shift(sample) : sample;
      for (let ch = 0; ch < output.length; ch++) output[ch]![i] = delayed * this.gain;
    }

    this.sum += quantumSum;
    this.count += samples ? samples.length : frames;
    if (this.count >= this.reportFrames) {
      const level = toDb(Math.sqrt(this.sum / this.count));
      this.floor.push(level);
      const message: GateMessage = { level, threshold, open, time: currentTime * 1000 };
      this.port.postMessage(message);
      this.sum = 0;
      this.count = 0;
    }
    return true;
  }
}

registerProcessor('metacode-mic-gate', MicGate);
