import { describe, expect, it } from 'vitest';
import {
  BUBBLE_MAX_CHARS,
  BUBBLE_MAX_STACK,
  type Bubble,
  activeBubbles,
  bubbleDurationMs,
  bubbleText,
  emoteText,
  pushBubble,
} from './bubbles';

const bubble = (id: string, expiresAt: number): Bubble => ({
  id,
  label: '#일반',
  text: id,
  kind: 'bubble',
  expiresAt,
});

describe('bubbleText', () => {
  it('줄바꿈과 연속 공백을 한 칸으로 합친다', () => {
    expect(bubbleText('  안녕\n\n반가워   요  ')).toBe('안녕 반가워 요');
  });

  it('긴 글은 줄이고 끝에 …을 붙인다', () => {
    const text = bubbleText('가'.repeat(200));
    expect(Array.from(text)).toHaveLength(BUBBLE_MAX_CHARS);
    expect(text.endsWith('…')).toBe(true);
  });

  it('이모지를 반으로 자르지 않는다', () => {
    const text = bubbleText('😀'.repeat(200));
    expect(text.replace('…', '')).toMatch(/^(😀)+$/u);
  });
});

describe('bubbleDurationMs', () => {
  it('짧은 글도 읽을 시간은 보이고, 긴 글도 끝없이 남지 않는다', () => {
    expect(bubbleDurationMs('응')).toBe(3_000);
    expect(bubbleDurationMs('가'.repeat(40))).toBeGreaterThan(3_000);
    expect(bubbleDurationMs('가'.repeat(200))).toBe(8_000);
  });
});

describe('pushBubble', () => {
  it('연속으로 말하면 쌓이고, 최대 개수를 넘으면 오래된 것부터 빠진다', () => {
    let stack: Bubble[] = [];
    for (let i = 0; i < BUBBLE_MAX_STACK + 2; i++)
      stack = pushBubble(stack, bubble(`m${i}`, 10_000), 0);
    expect(stack.map((b) => b.id)).toEqual(['m2', 'm3', 'm4']);
  });

  it('시간이 지난 말풍선은 사라진다', () => {
    const stack = pushBubble([bubble('old', 1_000)], bubble('new', 5_000), 2_000);
    expect(stack.map((b) => b.id)).toEqual(['new']);
    expect(activeBubbles(stack, 6_000)).toEqual([]);
  });
});

describe('emoteText', () => {
  it('사진만 올렸는지, 파일이 섞였는지 알려 준다', () => {
    expect(emoteText([{ kind: 'image' }, { kind: 'image' }])).toBe('🖼️ 2');
    expect(emoteText([{ kind: 'image' }, { kind: 'file' }])).toBe('📎 2');
  });
});
