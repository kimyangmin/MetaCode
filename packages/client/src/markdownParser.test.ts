import { describe, expect, it } from 'vitest';
import { extractMentions, markdownToPlain, parseInline, parseMarkdown } from './markdownParser.js';

const text = (value: string) => ({ type: 'text', value });

describe('글자 꾸미기', () => {
  it('굵게, 기울임, 밑줄, 취소선, 스포일러, 코드', () => {
    expect(parseInline('**굵게** *기울임* __밑줄__ ~~취소~~ ||비밀|| `코드`')).toEqual([
      { type: 'bold', children: [text('굵게')] },
      text(' '),
      { type: 'italic', children: [text('기울임')] },
      text(' '),
      { type: 'underline', children: [text('밑줄')] },
      text(' '),
      { type: 'strike', children: [text('취소')] },
      text(' '),
      { type: 'spoiler', children: [text('비밀')] },
      text(' '),
      { type: 'code', value: '코드' },
    ]);
  });

  it('겹쳐 쓸 수 있다', () => {
    expect(parseInline('***둘 다***')).toEqual([
      { type: 'bold', children: [{ type: 'italic', children: [text('둘 다')] }] },
    ]);
    expect(parseInline('*기울임 안에 **굵게** 도*')).toEqual([
      {
        type: 'italic',
        children: [text('기울임 안에 '), { type: 'bold', children: [text('굵게')] }, text(' 도')],
      },
    ]);
  });

  it('짝이 없거나 공백으로 떨어진 기호, 단어 속 _는 그대로 둔다', () => {
    expect(parseInline('2 * 3 * 4')).toEqual([text('2 * 3 * 4')]);
    expect(parseInline('**닫히지 않음')).toEqual([text('**닫히지 않음')]);
    expect(parseInline('snake_case_name')).toEqual([text('snake_case_name')]);
  });

  it('코드 안의 기호는 꾸미지 않고, \\로 기호를 그대로 쓴다', () => {
    expect(parseInline('`**그대로**`')).toEqual([{ type: 'code', value: '**그대로**' }]);
    expect(parseInline('\\*별\\*')).toEqual([text('*별*')]);
  });

  it('http(s) 주소와 [글](주소)만 링크가 된다', () => {
    expect(parseInline('[문서](https://a.com/x) 와 https://b.com')).toEqual([
      { type: 'link', href: 'https://a.com/x', children: [text('문서')] },
      text(' 와 '),
      { type: 'link', href: 'https://b.com', children: [text('https://b.com')] },
    ]);
    expect(parseInline('[눌러](javascript:alert(1))')).toEqual([
      text('[눌러](javascript:alert(1))'),
    ]);
  });
});

describe('블록', () => {
  it('코드 블록은 안쪽을 꾸미지 않고 줄바꿈을 지킨다', () => {
    expect(parseMarkdown('앞\n```ts\nconst a = **1**;\n\n```\n뒤')).toEqual([
      { type: 'paragraph', children: [text('앞')] },
      { type: 'code', lang: 'ts', value: 'const a = **1**;\n' },
      { type: 'paragraph', children: [text('뒤')] },
    ]);
    expect(parseMarkdown('```한 줄```')).toEqual([{ type: 'code', lang: '', value: '한 줄' }]);
  });

  it('닫히지 않은 코드 블록은 글자로 둔다', () => {
    expect(parseMarkdown('```\n열기만')).toEqual([
      { type: 'paragraph', children: [text('```\n열기만')] },
    ]);
  });

  it('인용, 끝까지 인용, 제목, 목록', () => {
    expect(parseMarkdown('> 인용 1\n> 인용 2\n보통')).toEqual([
      { type: 'quote', children: [{ type: 'paragraph', children: [text('인용 1\n인용 2')] }] },
      { type: 'paragraph', children: [text('보통')] },
    ]);
    expect(parseMarkdown('>>> 여기부터\n끝까지')).toEqual([
      { type: 'quote', children: [{ type: 'paragraph', children: [text('여기부터\n끝까지')] }] },
    ]);
    expect(parseMarkdown('## 제목')).toEqual([
      { type: 'heading', level: 2, children: [text('제목')] },
    ]);
    expect(parseMarkdown('- 하나\n- 둘\n3. 셋')).toEqual([
      { type: 'list', ordered: false, start: 1, items: [[text('하나')], [text('둘')]] },
      { type: 'list', ordered: true, start: 3, items: [[text('셋')]] },
    ]);
  });

  it('#이 붙어 있으면(해시태그) 제목이 아니다', () => {
    expect(parseMarkdown('#태그')).toEqual([{ type: 'paragraph', children: [text('#태그')] }]);
  });
});

describe('markdownToPlain', () => {
  it('기호를 빼고 스포일러는 가린다', () => {
    expect(markdownToPlain('**안녕** ||비밀이야|| `코드`')).toBe('안녕 ▒▒▒▒ 코드');
    expect(markdownToPlain('- 하나\n- 둘')).toBe('• 하나\n• 둘');
  });
});

describe('멘션', () => {
  it('@사용자ID를 멘션으로 나누고, 메일 주소·코드 안은 멘션이 아니다', () => {
    expect(parseInline('안녕 @Alice! a@b.com `@bob`')).toEqual([
      { type: 'text', value: '안녕 ' },
      { type: 'mention', username: 'alice' },
      { type: 'text', value: '! a@b.com ' },
      { type: 'code', value: '@bob' },
    ]);
  });

  it('글에서 멘션한 사람을 겹치지 않게 모으고, 기호를 뺀 글에서는 @아이디로 남긴다', () => {
    expect(extractMentions('**@carol** @dev-bob @Carol\n```\n@nobody\n```')).toEqual([
      'carol',
      'dev-bob',
    ]);
    expect(markdownToPlain('hi @Alice')).toBe('hi @alice');
  });
});
