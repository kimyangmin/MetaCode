import { describe, expect, it } from 'vitest';
import { titleFor } from './TitleBar';

const communities = [
  { id: 'c1', name: 'MetaCode팀' },
  { id: 'c2', name: '놀이터' },
];

describe('제목 표시줄 제목', () => {
  it('커뮤니티 화면이면 그 커뮤니티 이름, DM이면 Direct Message', () => {
    expect(titleFor('/c/c1', communities)).toBe('MetaCode팀');
    expect(titleFor('/c/c2/ch9', communities)).toBe('놀이터');
    expect(titleFor('/dm', communities)).toBe('Direct Message');
    expect(titleFor('/dm/ch1', communities)).toBe('Direct Message');
  });

  it('모르는 커뮤니티나 다른 화면은 MetaCode', () => {
    expect(titleFor('/c/unknown', communities)).toBe('MetaCode');
    expect(titleFor('/invite/AbCd2345', communities)).toBe('MetaCode');
    expect(titleFor('/c/c1', undefined)).toBe('MetaCode');
    expect(titleFor('/dmx', communities)).toBe('MetaCode');
  });
});
