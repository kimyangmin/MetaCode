import { describe, expect, it } from 'vitest';
import { titleBarKind, titleBarWindowOptions } from './titlebar';

describe('제목 표시줄', () => {
  it('Windows·Linux는 OS 제목 표시줄 없이 띄우고 창 조작 버튼도 웹이 그린다', () => {
    for (const platform of ['win32', 'linux'] as const) {
      expect(titleBarKind(platform)).toBe('custom');
      expect(titleBarWindowOptions(platform)).toEqual({ frame: false });
    }
  });

  it('macOS는 신호등 버튼을 OS 것으로 두고 나머지만 숨긴다', () => {
    expect(titleBarKind('darwin')).toBe('native-controls');
    expect(titleBarWindowOptions('darwin')).toMatchObject({ titleBarStyle: 'hidden' });
  });
});
