import { GATE_HOLD_MS } from './gate';

/**
 * 목소리만 통과시키는 문턱 (잡음 제거를 켰을 때). RNNoise는 사람 입에서 나는 소리(콧바람, 숨소리, 씹는 소리,
 * 입맛 다시는 소리)를 말소리로 보고 남기는 일이 많아서, 음량만 보는 문턱으로는 그대로 나갔다.
 * 말소리에는 성대가 떨려 생기는 주기(피치, 70~400Hz)가 있고 이런 소리에는 없다는 점으로 가른다.
 *
 * - VoicingDetector: 최근 약 43ms의 소리가 얼마나 주기적인지(0~1)를 잰다 (정규화 자기상관의 최댓값).
 * - VoiceGate: 음량이 문턱을 넘고 주기적인 소리가 있을 때만 열고, 목소리가 VOICE_HOLD_MS 동안 없거나
 *   조용해진 지 GATE_HOLD_MS가 지나면 닫는다.
 * - 무성 자음(ㅅ, ㅎ, ㅊ)으로 시작하는 말의 첫소리가 잘리지 않게, 소리를 VOICE_LOOKAHEAD_MS 늦게 내보내고
 *   판단은 가장 최근 소리로 한다 (micGate.worklet.ts). 지연이 그만큼 늘어난다.
 * 오디오 스레드(micGate.worklet.ts)와 테스트가 같은 코드를 쓴다.
 */

/** 이만큼 소리를 늦게 내보내 첫소리를 살린다 */
export const VOICE_LOOKAHEAD_MS = 40;
/** 주기성이 이 이상이면 목소리로 본다. 말소리의 모음은 보통 0.7 이상, 숨소리·씹는 소리는 0.3 아래다 */
export const VOICED_SCORE = 0.5;
/** 목소리가 이만큼 없으면 (음량이 커도) 닫는다: 말끝 뒤에 이어지는 숨소리를 끊는다 */
export const VOICE_HOLD_MS = 400;

/** 피치를 찾는 범위 (Hz): 낮은 남자 목소리 ~ 높은 여자·아이 목소리 */
const PITCH_MIN_HZ = 70;
const PITCH_MAX_HZ = 400;
/** 48kHz를 이만큼 줄여서(12kHz) 계산한다. 피치는 400Hz 아래라 충분하다 */
const DECIMATE = 4;
/** 분석 창 (줄인 뒤 샘플 수, 12kHz에서 약 43ms) */
const WINDOW = 512;
/** 이만큼(줄인 뒤 샘플 수, 약 10.7ms)마다 다시 잰다 */
const HOP = 128;
/** 바닥 울림(에어컨, 책상 두드림 등)을 빼는 고역 통과 필터의 기준 주파수 */
const HIGH_PASS_HZ = 80;

export class VoicingDetector {
  private readonly ring = new Float32Array(WINDOW);
  private readonly frame = new Float32Array(WINDOW);
  private write = 0;
  private filled = 0;
  private sinceAnalysis = 0;
  private readonly minLag: number;
  private readonly maxLag: number;
  private readonly hpAlpha: number;
  private hpIn = 0;
  private hpOut = 0;
  private acc = 0;
  private accCount = 0;
  /** 가장 최근에 잰 주기성 (0~1) */
  score = 0;

  constructor(sampleRate: number) {
    const rate = sampleRate / DECIMATE;
    this.minLag = Math.floor(rate / PITCH_MAX_HZ);
    this.maxLag = Math.ceil(rate / PITCH_MIN_HZ);
    const rc = 1 / (2 * Math.PI * HIGH_PASS_HZ);
    this.hpAlpha = rc / (rc + 1 / sampleRate);
  }

  /** 샘플을 넣는다 (원래 표본율). 다시 잴 때가 되면 score를 새로 구한다 */
  push(samples: ArrayLike<number>): void {
    for (let i = 0; i < samples.length; i++) {
      const x = samples[i]!;
      this.hpOut = this.hpAlpha * (this.hpOut + x - this.hpIn);
      this.hpIn = x;
      this.acc += this.hpOut;
      if (++this.accCount < DECIMATE) continue;
      this.ring[this.write] = this.acc / DECIMATE;
      this.write = (this.write + 1) % WINDOW;
      this.acc = 0;
      this.accCount = 0;
      if (this.filled < WINDOW) this.filled++;
      if (++this.sinceAnalysis >= HOP) {
        this.sinceAnalysis = 0;
        if (this.filled === WINDOW) this.score = this.analyze();
      }
    }
  }

  get voiced(): boolean {
    return this.score >= VOICED_SCORE;
  }

  /** 창 안의 소리가 피치 범위의 어떤 주기와 가장 잘 맞는지 (정규화 자기상관의 최댓값) */
  private analyze(): number {
    const x = this.frame;
    for (let i = 0; i < WINDOW; i++) x[i] = this.ring[(this.write + i) % WINDOW]!;
    let energy = 0;
    for (let i = 0; i < WINDOW; i++) energy += x[i]! * x[i]!;
    if (energy < 1e-9) return 0;
    let best = 0;
    for (let lag = this.minLag; lag <= this.maxLag; lag++) {
      let cross = 0;
      let a = 0;
      let b = 0;
      for (let i = 0; i + lag < WINDOW; i++) {
        const p = x[i]!;
        const q = x[i + lag]!;
        cross += p * q;
        a += p * p;
        b += q * q;
      }
      if (a > 0 && b > 0) {
        const r = cross / Math.sqrt(a * b);
        if (r > best) best = r;
      }
    }
    return best;
  }
}

/**
 * 목소리 문턱의 열림·닫힘. 음량이 문턱을 넘고(loud) 목소리(voiced)일 때 연다.
 * 열린 뒤에는 조용해진 지 GATE_HOLD_MS, 또는 목소리가 없어진 지 VOICE_HOLD_MS가 지나면 닫는다.
 * 목소리 없이 큰 소리(숨소리, 씹는 소리)만으로는 열리지 않는다.
 */
export class VoiceGate {
  private open = false;
  private lastLoudAt = -Infinity;
  private lastVoicedAt = -Infinity;

  push(levelDb: number, thresholdDb: number, voiced: boolean, timeMs: number): boolean {
    const loud = levelDb >= thresholdDb;
    if (loud && voiced) this.open = true;
    if (this.open) {
      if (loud) this.lastLoudAt = timeMs;
      if (voiced) this.lastVoicedAt = timeMs;
      if (timeMs - this.lastLoudAt >= GATE_HOLD_MS || timeMs - this.lastVoicedAt >= VOICE_HOLD_MS) {
        this.open = false;
      }
    }
    return this.open;
  }

  get isOpen(): boolean {
    return this.open;
  }
}

/** 소리를 정해진 샘플 수만큼 늦게 내보낸다 (미리 보고 판단하려고) */
export class DelayLine {
  private readonly buffer: Float32Array;
  private index = 0;

  constructor(samples: number) {
    this.buffer = new Float32Array(Math.max(1, samples));
  }

  /** 넣은 샘플 대신 samples만큼 앞의 샘플을 돌려준다 */
  shift(sample: number): number {
    const out = this.buffer[this.index]!;
    this.buffer[this.index] = sample;
    this.index = (this.index + 1) % this.buffer.length;
    return out;
  }
}
