import { describe, expect, it } from 'vitest';
import {
  AUTO_MAX_DB,
  AUTO_MIN_DB,
  GATE_HOLD_MS,
  GateState,
  NoiseFloor,
  gainStep,
  levelRatio,
  toDb,
} from './gate';

describe('소리 문턱', () => {
  it('문턱을 넘으면 바로 열고, 조용해진 뒤 잠시 열어 두었다가 닫는다', () => {
    const gate = new GateState();
    expect(gate.push(-70, -50, 0)).toBe(false);
    expect(gate.push(-30, -50, 10)).toBe(true);
    // 말끝: 문턱 아래여도 GATE_HOLD_MS 동안은 열려 있다
    expect(gate.push(-70, -50, 10 + GATE_HOLD_MS - 1)).toBe(true);
    expect(gate.push(-70, -50, 10 + GATE_HOLD_MS)).toBe(false);
  });

  it('열려 있는 동안 다시 문턱을 넘으면 닫는 시각이 미뤄진다', () => {
    const gate = new GateState();
    gate.push(-30, -50, 0);
    gate.push(-30, -50, 200);
    expect(gate.push(-70, -50, 300)).toBe(true);
    expect(gate.push(-70, -50, 200 + GATE_HOLD_MS)).toBe(false);
  });
});

describe('자동 입력 감도', () => {
  it('바닥 잡음은 조용해지면 빨리 따라 내려가고, 말소리에는 천천히만 올라간다', () => {
    const floor = new NoiseFloor(-60);
    for (let i = 0; i < 20; i++) floor.push(-80);
    expect(floor.value).toBeLessThan(-79);
    // 1초(20ms × 50) 동안 말해도 바닥은 거의 그대로
    for (let i = 0; i < 50; i++) floor.push(-20);
    expect(floor.value).toBeLessThan(-72);
  });

  it('자동 문턱은 바닥 잡음 + 여유를 정해진 범위 안에서 쓴다', () => {
    expect(new NoiseFloor(-100).threshold()).toBe(AUTO_MIN_DB);
    expect(new NoiseFloor(-60).threshold()).toBe(-45);
    expect(new NoiseFloor(-20).threshold()).toBe(AUTO_MAX_DB);
  });
});

describe('계산', () => {
  it('dB 변환과 막대 위치', () => {
    expect(toDb(1)).toBe(0);
    expect(toDb(0.1)).toBeCloseTo(-20);
    expect(toDb(0)).toBe(-100);
    expect(levelRatio(-80)).toBe(0);
    expect(levelRatio(-40)).toBe(0.5);
    expect(levelRatio(10)).toBe(1);
  });

  it('소리 크기 이동 비율은 짧을수록 크다', () => {
    expect(gainStep(5, 48_000)).toBeGreaterThan(gainStep(60, 48_000));
    expect(gainStep(5, 48_000)).toBeLessThan(1);
  });
});
