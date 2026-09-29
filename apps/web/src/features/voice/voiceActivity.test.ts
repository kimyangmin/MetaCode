import { describe, expect, it } from 'vitest';
import { GATE_HOLD_MS } from './gate';
import { DelayLine, VOICE_HOLD_MS, VoiceGate, VoicingDetector } from './voiceActivity';

const RATE = 48_000;

/** 결정적인 난수 (테스트가 늘 같게) */
function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32 - 0.5;
  };
}

/** 모음 비슷한 소리: 기본 주파수와 배음 몇 개 + 약간의 잡음 */
function vowel(hz: number, ms: number, seed = 1): Float32Array {
  const rnd = random(seed);
  const out = new Float32Array(Math.round((RATE * ms) / 1000));
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    let v = 0;
    for (let k = 1; k <= 5; k++) v += Math.sin(2 * Math.PI * hz * k * t) / k;
    out[i] = 0.2 * v + 0.02 * rnd();
  }
  return out;
}

/** 숨소리 비슷한 소리: 넓은 대역의 잡음 */
function breath(ms: number, seed = 2): Float32Array {
  const rnd = random(seed);
  return Float32Array.from({ length: Math.round((RATE * ms) / 1000) }, () => 0.3 * rnd());
}

/** 씹는 소리 비슷한 소리: 드문드문 딸깍하는 짧은 소리 */
function clicks(ms: number, seed = 3): Float32Array {
  const rnd = random(seed);
  const out = new Float32Array(Math.round((RATE * ms) / 1000));
  for (let i = 0; i < out.length; i++) {
    if (rnd() > 0.4985) {
      for (let j = 0; j < 60 && i + j < out.length; j++) out[i + j] = 0.6 * rnd() * (1 - j / 60);
    }
  }
  return out;
}

function scoreOf(samples: Float32Array): number {
  const detector = new VoicingDetector(RATE);
  detector.push(samples);
  return detector.score;
}

describe('목소리 가르기 (주기성)', () => {
  it('모음은 높고, 숨소리·씹는 소리는 낮다', () => {
    for (const hz of [90, 150, 220, 330]) expect(scoreOf(vowel(hz, 200))).toBeGreaterThan(0.7);
    expect(scoreOf(breath(200))).toBeLessThan(0.35);
    expect(scoreOf(clicks(200))).toBeLessThan(0.45);
  });

  it('조용하면 0이다', () => {
    expect(scoreOf(new Float32Array(RATE / 5))).toBe(0);
  });
});

describe('목소리 문턱', () => {
  /** 10ms씩 (음량, 목소리 여부)를 넣고 열림을 모은다 */
  const run = (steps: [loud: boolean, voiced: boolean][], gate = new VoiceGate()) =>
    steps.map(([loud, voiced], i) => gate.push(loud ? -20 : -70, -45, voiced, i * 10));

  it('목소리 없이 큰 소리(숨소리, 씹는 소리)로는 열리지 않는다', () => {
    const opened = run(Array.from({ length: 50 }, () => [true, false]));
    expect(opened.some(Boolean)).toBe(false);
  });

  it('목소리면 열고, 조용해진 뒤 잠시 두었다 닫는다', () => {
    const gate = new VoiceGate();
    expect(gate.push(-20, -45, true, 0)).toBe(true);
    // 말 사이 무성음(크지만 목소리 아님)은 이어서 통과한다.
    expect(gate.push(-20, -45, false, 100)).toBe(true);
    expect(gate.push(-70, -45, false, 100 + GATE_HOLD_MS - 10)).toBe(true);
    expect(gate.push(-70, -45, false, 100 + GATE_HOLD_MS + 10)).toBe(false);
  });

  it('말끝 뒤에 이어지는 숨소리는 목소리가 끊긴 지 잠시 뒤 끊는다', () => {
    const gate = new VoiceGate();
    gate.push(-20, -45, true, 0);
    let t = 0;
    let open = true;
    while (open && t < 2000) {
      t += 10;
      open = gate.push(-20, -45, false, t);
    }
    expect(t).toBeGreaterThanOrEqual(VOICE_HOLD_MS);
    expect(t).toBeLessThan(VOICE_HOLD_MS + 20);
  });
});

describe('지연선', () => {
  it('정한 샘플 수만큼 늦게 내보낸다', () => {
    const line = new DelayLine(3);
    expect([1, 2, 3, 4, 5].map((x) => line.shift(x))).toEqual([0, 0, 0, 1, 2]);
  });
});
