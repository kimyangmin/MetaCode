/** 이 음량(dBFS, 20ms 구간의 RMS) 이상이면 말소리로 본다. 잡음 억제를 거친 조용한 마이크는 -60 아래다 */
export const SPEECH_THRESHOLD_DB = -45;
/** 이만큼 이어져야 말하기 시작으로 본다 (딸깍 소리 같은 순간 잡음을 거른다) */
export const SPEECH_ATTACK_MS = 40;
/** 조용해진 뒤 이만큼 지나야 멈춘 것으로 본다 (단어 사이에 깜빡이지 않게) */
export const SPEECH_RELEASE_MS = 300;

export interface SpeechOptions {
  thresholdDb: number;
  attackMs: number;
  releaseMs: number;
}

/**
 * 마이크 음량으로 말하는 중인지 판단한다. 음량과 그 시각을 차례로 넣으면 상태가 바뀔 때만 알려 준다.
 * 시간은 넣어 준 시각으로만 재고 타이머를 쓰지 않는다 (가려진 창에서는 타이머가 늦어진다).
 */
export class SpeechDetector {
  private speaking = false;
  /** 기준을 넘기 시작한 시각 (말하기 전) */
  private loudSince: number | null = null;
  /** 마지막으로 기준을 넘은 시각 (말하는 중) */
  private lastLoudAt = 0;

  constructor(
    private readonly options: SpeechOptions = {
      thresholdDb: SPEECH_THRESHOLD_DB,
      attackMs: SPEECH_ATTACK_MS,
      releaseMs: SPEECH_RELEASE_MS,
    },
  ) {}

  /**
   * 상태가 바뀌었으면 새 상태, 그대로면 null.
   * thresholdDb를 주면 그 기준으로 본다 (입력 감도: 소리 문턱과 같은 기준을 쓰도록)
   */
  push(levelDb: number, timeMs: number, thresholdDb = this.options.thresholdDb): boolean | null {
    const loud = levelDb >= thresholdDb;
    if (this.speaking) {
      if (loud) this.lastLoudAt = timeMs;
      else if (timeMs - this.lastLoudAt >= this.options.releaseMs) return this.set(false);
      return null;
    }
    if (!loud) {
      this.loudSince = null;
      return null;
    }
    this.loudSince ??= timeMs;
    if (timeMs - this.loudSince < this.options.attackMs) return null;
    this.lastLoudAt = timeMs;
    return this.set(true);
  }

  /** 마이크가 꺼졌거나 바뀌었다. 말하던 중이었으면 true */
  reset(): boolean {
    const was = this.speaking;
    this.set(false);
    return was;
  }

  private set(speaking: boolean): boolean {
    this.speaking = speaking;
    this.loudSince = null;
    return speaking;
  }
}
