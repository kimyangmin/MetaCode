import { describe, expect, it } from 'vitest';
import { viewerStatus } from './ScreenViewer';

const base = {
  joining: false,
  error: null,
  connecting: false,
  sharing: true,
  stream: false,
  slow: false,
};

describe('화면 공유 보기 창의 상태', () => {
  it('들어가는 중 → 불러오는 중 → 보는 중', () => {
    expect(viewerStatus({ ...base, joining: true })).toEqual({ kind: 'joining' });
    expect(viewerStatus({ ...base, connecting: true })).toEqual({ kind: 'joining' });
    expect(viewerStatus(base)).toEqual({ kind: 'loading', slow: false });
    expect(viewerStatus({ ...base, slow: true })).toEqual({ kind: 'loading', slow: true });
    expect(viewerStatus({ ...base, stream: true })).toEqual({ kind: 'playing' });
  });

  it('들어가지 못했으면 사유를, 공유가 끝났으면 끝남을 보여 준다', () => {
    expect(viewerStatus({ ...base, joining: true, error: '권한이 없습니다.' })).toEqual({
      kind: 'error',
      message: '권한이 없습니다.',
    });
    expect(viewerStatus({ ...base, sharing: false, stream: true })).toEqual({ kind: 'ended' });
  });
});
