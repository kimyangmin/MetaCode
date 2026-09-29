/**
 * 마이크 소리 문턱 + 음량 측정기 (AudioWorklet, 오디오 스레드).
 * - 문턱: 음량이 문턱을 넘으면 바로 열고, 조용해지면 잠시 뒤 부드럽게 닫는다 (gate.ts).
 *   오디오 스레드에서 판단해서 화면이 바쁘거나 창이 가려져도 첫소리가 잘리지 않는다.
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

  constructor() {
    super();
    this.port.onmessage = ({ data }: MessageEvent<{ sensitivity: Sensitivity }>) => {
      if (data.sensitivity) this.sensitivity = data.sensitivity;
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
    const open = this.gate.push(quantumDb, threshold, currentTime * 1000);
    const target = open ? 1 : 0;

    // 소리 크기를 샘플마다 부드럽게 옮기며 곱한다 (모든 채널에 같은 크기).
    for (let i = 0; i < frames; i++) {
      this.gain += (target - this.gain) * (target > this.gain ? this.attack : this.release);
      for (let ch = 0; ch < output.length; ch++) {
        const source = input[ch] ?? samples;
        output[ch]![i] = source ? source[i]! * this.gain : 0;
      }
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
