import type { MessageDto } from '@metacode/shared';
import { describe, expect, it, vi } from 'vitest';
import { createModifierChord, rangeMessages, stepMessage, transcript } from './messageSelection';

const author = { id: 'u1', username: 'bob', displayName: '밥', avatarUrl: '', character: null };
function message(id: string, content: string, createdAt: string, files: string[] = []): MessageDto {
  return {
    id,
    channelId: 'c1',
    author,
    content,
    createdAt,
    editedAt: null,
    replyTo: null,
    forwarded: false,
    attachments: files.map((fileName, i) => ({
      id: `${id}-${i}`,
      kind: 'file',
      fileName,
      contentType: 'application/octet-stream',
      size: 1,
      width: null,
      height: null,
    })),
  } as MessageDto;
}

// 최신부터
const list = [
  message('m3', '셋', '2026-09-29T03:00:00Z', ['a.txt']),
  message('m2', '둘', '2026-09-29T02:00:00Z'),
  message('m1', '하나', '2026-09-28T02:00:00Z'),
];

describe('잡기 범위', () => {
  it('두 끝 사이를 오래된 것부터 돌려준다 (어느 쪽으로 늘려도)', () => {
    expect(rangeMessages(list, { anchor: 'm3', focus: 'm2' }).map((m) => m.id)).toEqual([
      'm2',
      'm3',
    ]);
    expect(rangeMessages(list, { anchor: 'm1', focus: 'm3' }).map((m) => m.id)).toEqual([
      'm1',
      'm2',
      'm3',
    ]);
    expect(rangeMessages(list, { anchor: 'gone', focus: 'm3' })).toEqual([]);
  });

  it('위는 오래된 쪽, 아래는 최신 쪽이고 끝에서 멈춘다', () => {
    expect(stepMessage(list, 'm3', true)).toBe('m2');
    expect(stepMessage(list, 'm1', true)).toBe('m1');
    expect(stepMessage(list, 'm2', false)).toBe('m3');
    expect(stepMessage(list, 'm3', false)).toBe('m3');
  });

  it('복사하는 기록은 날짜 줄과 "[시각] 이름: 내용 📎 파일"', () => {
    const text = transcript([...list].reverse());
    const lines = text.split('\n');
    expect(lines.filter((l) => l.startsWith('──'))).toHaveLength(2);
    expect(lines.at(-1)).toMatch(/^\[.+\] 밥: 셋 📎 a\.txt$/);
  });
});

describe('Ctrl+Shift', () => {
  const key = (k: string, mods: { ctrl?: boolean; shift?: boolean } = {}) => ({
    key: k,
    ctrlKey: !!mods.ctrl,
    shiftKey: !!mods.shift,
    altKey: false,
    metaKey: false,
  });

  it('둘을 함께 눌렀다 떼면 알린다 (누르는 순서는 상관없음)', () => {
    const onChord = vi.fn();
    const chord = createModifierChord(onChord);
    chord.keydown(key('Control', { ctrl: true }));
    chord.keydown(key('Shift', { ctrl: true, shift: true }));
    chord.keyup({ key: 'Shift' });
    expect(onChord).toHaveBeenCalledTimes(1);
    chord.keyup({ key: 'Control' });
    expect(onChord).toHaveBeenCalledTimes(1);
  });

  it('사이에 다른 키를 누르면(Ctrl+Shift+Z) 알리지 않는다', () => {
    const onChord = vi.fn();
    const chord = createModifierChord(onChord);
    chord.keydown(key('Shift', { shift: true }));
    chord.keydown(key('Control', { ctrl: true, shift: true }));
    chord.keydown(key('Z', { ctrl: true, shift: true }));
    chord.keyup({ key: 'Control' });
    expect(onChord).not.toHaveBeenCalled();
  });

  it('하나만 눌렀다 떼면 알리지 않는다', () => {
    const onChord = vi.fn();
    const chord = createModifierChord(onChord);
    chord.keydown(key('Shift', { shift: true }));
    chord.keyup({ key: 'Shift' });
    expect(onChord).not.toHaveBeenCalled();
  });
});
