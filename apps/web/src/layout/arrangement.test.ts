import { describe, expect, it } from 'vitest';
import { arrangementFor, edgeAt, isOutsideWindow } from './arrangement';

const rect = { left: 0, top: 0, width: 1000, height: 500 };

describe('edgeAt', () => {
  it('가장 가까운 가장자리를 영역 비율로 고른다', () => {
    expect(edgeAt(rect, 50, 250)).toBe('left');
    expect(edgeAt(rect, 950, 250)).toBe('right');
    expect(edgeAt(rect, 500, 30)).toBe('top');
    expect(edgeAt(rect, 500, 480)).toBe('bottom');
    // 가로가 긴 영역에서도 위아래 가장자리 근처면 위아래다.
    expect(edgeAt(rect, 300, 40)).toBe('top');
  });
});

describe('arrangementFor', () => {
  it('끈 패널이 놓은 쪽으로 간다', () => {
    expect(arrangementFor('plaza', 'left')).toEqual({ orientation: 'horizontal', first: 'plaza' });
    expect(arrangementFor('plaza', 'right')).toEqual({ orientation: 'horizontal', first: 'chat' });
    expect(arrangementFor('chat', 'top')).toEqual({ orientation: 'vertical', first: 'chat' });
    expect(arrangementFor('chat', 'bottom')).toEqual({ orientation: 'vertical', first: 'plaza' });
  });
});

describe('isOutsideWindow', () => {
  const win = { x: 100, y: 100, width: 800, height: 600 };
  it('창 밖에서 놓았는지', () => {
    expect(isOutsideWindow({ x: 500, y: 400 }, win)).toBe(false);
    expect(isOutsideWindow({ x: 50, y: 400 }, win)).toBe(true);
    expect(isOutsideWindow({ x: 500, y: 750 }, win)).toBe(true);
  });
});
