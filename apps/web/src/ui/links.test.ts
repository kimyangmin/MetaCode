import { describe, expect, it } from 'vitest';
import { splitLinks } from './links';

describe('splitLinks', () => {
  it('글 사이의 주소를 링크로 나눈다', () => {
    expect(splitLinks('여기 https://example.com/a?b=1 봐')).toEqual([
      { type: 'text', value: '여기 ' },
      { type: 'link', value: 'https://example.com/a?b=1' },
      { type: 'text', value: ' 봐' },
    ]);
  });

  it('끝에 붙은 문장 부호는 링크에서 뺀다', () => {
    expect(splitLinks('(http://a.com).')).toEqual([
      { type: 'text', value: '(' },
      { type: 'link', value: 'http://a.com' },
      { type: 'text', value: ').' },
    ]);
  });

  it('http(s)가 아닌 주소는 링크로 만들지 않는다', () => {
    expect(splitLinks('javascript:alert(1) ftp://x.com')).toEqual([
      { type: 'text', value: 'javascript:alert(1) ftp://x.com' },
    ]);
  });

  it('주소가 여러 개여도, 없어도 된다', () => {
    expect(
      splitLinks('a https://x.io b https://y.io').filter((p) => p.type === 'link'),
    ).toHaveLength(2);
    expect(splitLinks('그냥 글')).toEqual([{ type: 'text', value: '그냥 글' }]);
  });
});
