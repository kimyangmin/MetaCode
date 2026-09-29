/**
 * 소리 문턱(노이즈 게이트)과 입력 감도. 오디오 스레드(micGate.worklet.ts)와 화면(말하는 중 표시, 감도 막대)이
 * 같은 계산을 쓴다. 음량은 dBFS(0이 가장 큼, 조용할수록 음수).
 */

/** 입력 감도: 자동(잡음 크기를 보고 문턱을 정함) 또는 직접 정한 문턱 */
export interface Sensitivity {
  mode: 'auto' | 'manual';
  /** 직접 정한 문턱 (dBFS). 자동일 때는 쓰지 않지만 기억해 둔다 */
  thresholdDb: number;
}

/** 감도 막대에 그리는 범위 (dBFS) */
export const LEVEL_MIN_DB = -80;
export const LEVEL_MAX_DB = 0;
/** 직접 정할 수 있는 문턱 범위 */
export const THRESHOLD_MIN_DB = -80;
export const THRESHOLD_MAX_DB = -10;
export const DEFAULT_SENSITIVITY: Sensitivity = { mode: 'auto', thresholdDb: -50 };

/** 자동 문턱 = 바닥 잡음 + 이만큼. 그리고 이 범위 안으로 */
export const AUTO_MARGIN_DB = 15;
export const AUTO_MIN_DB = -55;
export const AUTO_MAX_DB = -35;

/** 문턱을 넘은 뒤 조용해져도 이만큼은 열어 둔다 (말끝이 잘리지 않게) */
export const GATE_HOLD_MS = 250;
/** 열 때와 닫을 때 소리를 키우고 줄이는 시간 (딱 끊기면 "틱" 소리가 난다) */
export const GATE_ATTACK_MS = 5;
export const GATE_RELEASE_MS = 60;

/**
 * 바닥 잡음 추적: 더 조용해지면 빨리 따라 내려가고, 커지면 아주 천천히 올라간다
 * (말소리가 잠깐 이어져도 바닥으로 여기지 않게). 20ms마다 그 구간의 음량을 넣는다.
 */
export class NoiseFloor {
  constructor(private floor = -60) {}

  push(levelDb: number): void {
    const diff = levelDb - this.floor;
    // 내려갈 때는 절반씩, 올라갈 때는 0.2%씩 (약 10초에 걸쳐 따라감)
    this.floor += diff < 0 ? diff * 0.5 : diff * 0.002;
  }

  get value(): number {
    return this.floor;
  }

  /** 자동 문턱 */
  threshold(): number {
    return clamp(this.floor + AUTO_MARGIN_DB, AUTO_MIN_DB, AUTO_MAX_DB);
  }
}

/**
 * 문턱 열림·닫힘. 문턱을 넘으면 바로 열고(첫소리가 잘리지 않게), 문턱 아래로 GATE_HOLD_MS가 지나면 닫는다.
 * 시각은 넣어 준 값으로만 잰다 (오디오 스레드의 currentTime).
 */
export class GateState {
  private open = false;
  private lastLoudAt = -Infinity;

  push(levelDb: number, thresholdDb: number, timeMs: number): boolean {
    if (levelDb >= thresholdDb) {
      this.open = true;
      this.lastLoudAt = timeMs;
    } else if (this.open && timeMs - this.lastLoudAt >= GATE_HOLD_MS) {
      this.open = false;
    }
    return this.open;
  }

  get isOpen(): boolean {
    return this.open;
  }
}

/** 한 샘플마다 소리 크기(0~1)를 목표 쪽으로 옮길 비율. 열 때는 빠르게, 닫을 때는 천천히 */
export function gainStep(ms: number, sampleRate: number): number {
  return 1 - Math.exp(-1 / ((ms / 1000) * sampleRate));
}

/** RMS → dBFS (완전히 조용하면 -100) */
export function toDb(rms: number): number {
  return rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100;
}

/** 감도 막대에서의 위치 (0~1) */
export function levelRatio(db: number): number {
  return clamp((db - LEVEL_MIN_DB) / (LEVEL_MAX_DB - LEVEL_MIN_DB), 0, 1);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
