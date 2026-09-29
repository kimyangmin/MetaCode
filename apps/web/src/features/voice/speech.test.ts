import { describe, expect, it } from 'vitest';
import { SpeechDetector } from './speech';

const LOUD = -20;
const QUIET = -70;

/** 20ms마다 음량을 넣고, 상태가 바뀐 시각과 값을 모은다 */
function run(detector: SpeechDetector, levels: number[], startMs = 0): [number, boolean][] {
  const changes: [number, boolean][] = [];
  levels.forEach((level, i) => {
    const time = startMs + i * 20;
    const changed = detector.push(level, time);
    if (changed !== null) changes.push([time, changed]);
  });
  return changes;
}

const frames = (level: number, count: number) => Array.from({ length: count }, () => level);

describe('SpeechDetector', () => {
  const options = { thresholdDb: -45, attackMs: 40, releaseMs: 300 };

  it('기준을 넘는 소리가 attackMs 이어지면 말하는 중이 된다', () => {
    const detector = new SpeechDetector(options);
    expect(run(detector, [QUIET, LOUD, LOUD, LOUD, LOUD])).toEqual([[60, true]]);
  });

  it('순간 잡음(한 구간)은 말로 보지 않는다', () => {
    const detector = new SpeechDetector(options);
    expect(run(detector, [LOUD, QUIET, LOUD, QUIET, LOUD, QUIET])).toEqual([]);
  });

  it('조용해지고 releaseMs가 지나야 멈춘 것으로 본다', () => {
    const detector = new SpeechDetector(options);
    // 0~80ms 말함(마지막으로 큰 소리 80ms), 이후 조용 → 380ms에 멈춤
    const changes = run(detector, [...frames(LOUD, 5), ...frames(QUIET, 20)]);
    expect(changes).toEqual([
      [40, true],
      [380, false],
    ]);
  });

  it('단어 사이의 짧은 쉼에는 꺼지지 않는다', () => {
    const detector = new SpeechDetector(options);
    const changes = run(detector, [
      ...frames(LOUD, 5),
      ...frames(QUIET, 10), // 200ms 쉼
      ...frames(LOUD, 5),
    ]);
    expect(changes).toEqual([[40, true]]);
  });

  it('기준보다 작은 소리는 아무리 길어도 말로 보지 않는다', () => {
    const detector = new SpeechDetector(options);
    expect(run(detector, frames(-46, 100))).toEqual([]);
  });

  it('reset하면 말하던 중이었는지 알려 주고 처음 상태로 돌아간다', () => {
    const detector = new SpeechDetector(options);
    run(detector, frames(LOUD, 5));
    expect(detector.reset()).toBe(true);
    expect(detector.reset()).toBe(false);
    // 다시 attackMs를 채워야 켜진다.
    expect(run(detector, frames(LOUD, 3), 1000)).toEqual([[1040, true]]);
  });

  it('기준을 넘겨주면 그 기준으로 본다 (입력 감도를 따라)', () => {
    const detector = new SpeechDetector(options);
    // 기본 기준(-45)보다 작지만 넘겨준 기준(-60)보다는 크다
    expect(detector.push(-50, 0, -60)).toBeNull();
    expect(detector.push(-50, 40, -60)).toBe(true);
  });
});
