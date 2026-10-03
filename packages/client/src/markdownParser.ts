import { splitLinks } from './links.js';

/**
 * 채팅 메시지의 마크다운 (Discord와 비슷한 범위). 결과는 트리이고 화면은 이것을 React 요소로 그리므로
 * HTML이 끼어들 틈이 없다. 링크는 http(s)만 만든다.
 *
 * 블록: ```코드 블록```, > 인용, >>> 끝까지 인용, # / ## / ### 제목, - / * / 1. 목록, 나머지는 문단(줄바꿈 유지)
 * 글자: **굵게**, *기울임* / _기울임_, __밑줄__, ~~취소선~~, ||스포일러||, `코드`, [글](https://주소), 주소 자동 링크,
 *       \로 기호 그대로 쓰기
 */
export type Inline =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; children: Inline[] }
  /** @사용자ID (GitHub 로그인 이름, 소문자로) */
  | { type: 'mention'; username: string }
  | {
      type: 'bold' | 'italic' | 'underline' | 'strike' | 'spoiler';
      children: Inline[];
    };

export type Block =
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'code'; lang: string; value: string }
  | { type: 'quote'; children: Block[] }
  | { type: 'heading'; level: 1 | 2 | 3; children: Inline[] }
  | { type: 'list'; ordered: boolean; start: number; items: Inline[][] };

const FENCE = /^```([\w+-]*)\s*$/;
const ONE_LINE_FENCE = /^```([^`]+)```\s*$/;
const HEADING = /^(#{1,3}) (.+)$/;
const BULLET = /^\s*[-*] (.*)$/;
const NUMBERED = /^\s*(\d{1,9})[.)] (.*)$/;

export function parseMarkdown(text: string): Block[] {
  return parseBlocks(text.replace(/\r\n?/g, '\n').split('\n'), true);
}

function parseBlocks(lines: string[], allowQuote: boolean): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length === 0) return;
    blocks.push({ type: 'paragraph', children: parseInline(paragraph.join('\n')) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    const oneLine = ONE_LINE_FENCE.exec(line);
    if (oneLine) {
      flush();
      blocks.push({ type: 'code', lang: '', value: oneLine[1]! });
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const end = lines.findIndex((l, j) => j > i && l.trimEnd() === '```');
      if (end !== -1) {
        flush();
        blocks.push({ type: 'code', lang: fence[1]!, value: lines.slice(i + 1, end).join('\n') });
        i = end;
        continue;
      }
    }

    if (allowQuote && line.startsWith('>>> ')) {
      flush();
      const rest = [line.slice(4), ...lines.slice(i + 1)];
      blocks.push({ type: 'quote', children: parseBlocks(rest, false) });
      break;
    }
    if (allowQuote && (line.startsWith('> ') || line === '>')) {
      flush();
      const quoted: string[] = [];
      while (i < lines.length && (lines[i]!.startsWith('> ') || lines[i] === '>')) {
        quoted.push(lines[i]!.slice(2));
        i++;
      }
      i--;
      blocks.push({ type: 'quote', children: parseBlocks(quoted, false) });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({
        type: 'heading',
        level: heading[1]!.length as 1 | 2 | 3,
        children: parseInline(heading[2]!),
      });
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      flush();
      const ordered = !!numbered;
      const pattern = ordered ? NUMBERED : BULLET;
      const items: Inline[][] = [];
      while (i < lines.length) {
        const match = pattern.exec(lines[i]!);
        if (!match) break;
        items.push(parseInline(match[ordered ? 2 : 1]!));
        i++;
      }
      i--;
      blocks.push({ type: 'list', ordered, start: ordered ? Number(numbered![1]) : 1, items });
      continue;
    }

    paragraph.push(line);
  }
  flush();
  return blocks;
}

/** 짝을 맞춰 감싸는 기호. 긴 것부터 본다 (** 가 * 보다 먼저) */
const WRAPPERS: { mark: string; type: 'bold' | 'italic' | 'underline' | 'strike' | 'spoiler' }[] = [
  { mark: '**', type: 'bold' },
  { mark: '__', type: 'underline' },
  { mark: '~~', type: 'strike' },
  { mark: '||', type: 'spoiler' },
  { mark: '*', type: 'italic' },
  { mark: '_', type: 'italic' },
];

const ESCAPABLE = /[\\*_~|`[\]()#>-]/;
const MASKED_LINK = /^\[([^\]\n]+)\]\((https?:\/\/[^\s()<>]+)\)/;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let buffer = '';
  const pushText = () => {
    if (!buffer) return;
    // 글자 속 주소는 링크로
    for (const part of splitLinks(buffer)) {
      if (part.type === 'link') {
        out.push({
          type: 'link',
          href: part.value,
          children: [{ type: 'text', value: part.value }],
        });
      } else {
        out.push(...splitMentions(part.value));
      }
    }
    buffer = '';
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;

    if (ch === '\\' && i + 1 < text.length && ESCAPABLE.test(text[i + 1]!)) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }

    if (ch === '`') {
      let run = 1;
      while (text[i + run] === '`') run++;
      const fence = '`'.repeat(run);
      const end = text.indexOf(fence, i + run);
      if (end > i + run) {
        pushText();
        out.push({ type: 'code', value: text.slice(i + run, end) });
        i = end + run;
        continue;
      }
      buffer += fence;
      i += run;
      continue;
    }

    if (ch === '[') {
      const link = MASKED_LINK.exec(text.slice(i));
      if (link) {
        pushText();
        out.push({ type: 'link', href: link[2]!, children: parseInline(link[1]!) });
        i += link[0].length;
        continue;
      }
    }

    const wrapped = matchWrapper(text, i);
    if (wrapped) {
      pushText();
      out.push({ type: wrapped.type, children: parseInline(wrapped.inner) });
      i = wrapped.end;
      continue;
    }

    buffer += ch;
    i++;
  }
  pushText();
  return out;
}

/** i에서 시작하는 감싸기 기호와 짝이 되는 닫는 기호를 찾는다 */
function matchWrapper(
  text: string,
  i: number,
): { type: (typeof WRAPPERS)[number]['type']; inner: string; end: number } | null {
  for (const { mark, type } of WRAPPERS) {
    if (!text.startsWith(mark, i)) continue;
    const open = i + mark.length;
    // 여는 기호 바로 뒤가 공백이면 강조가 아니다 ("2 * 3 * 4" 같은 글)
    if (open >= text.length || /\s/.test(text[open]!)) continue;
    // _는 단어 가운데(snake_case)에서는 강조가 아니다
    if (mark === '_' && i > 0 && /\w/.test(text[i - 1]!)) continue;
    let search = open;
    while (search < text.length) {
      let close = text.indexOf(mark, search);
      if (close === -1) break;
      const single = mark.length === 1;
      // ***둘 다*** 처럼 기호가 이어지면 닫는 기호는 그 줄의 끝 쪽이다 (안쪽의 *기울임*이 짝을 찾게)
      if (!single) while (text[close + mark.length] === mark[0]) close++;
      // *기울임* 을 찾을 때 **굵게**의 기호는 건너뛴다
      if (single && text[close + 1] === mark) {
        search = close + 2;
        continue;
      }
      if (close > open && !/\s/.test(text[close - 1]!)) {
        if (mark === '_' && /\w/.test(text[close + 1] ?? '')) {
          search = close + 1;
          continue;
        }
        return { type, inner: text.slice(open, close), end: close + mark.length };
      }
      search = close + 1;
    }
  }
  return null;
}

/**
 * 기호를 뺀 글 (광장 말풍선, 답장 미리보기). 스포일러는 가린다 (말풍선에서 내용이 보이지 않게).
 */
export function markdownToPlain(text: string): string {
  return parseMarkdown(text)
    .map((block) => blockPlain(block))
    .join('\n');
}

function blockPlain(block: Block): string {
  switch (block.type) {
    case 'paragraph':
    case 'heading':
      return inlinePlain(block.children);
    case 'code':
      return block.value;
    case 'quote':
      return block.children.map(blockPlain).join('\n');
    case 'list':
      return block.items
        .map((item, i) => `${block.ordered ? `${block.start + i}.` : '•'} ${inlinePlain(item)}`)
        .join('\n');
  }
}

function inlinePlain(nodes: Inline[]): string {
  return nodes
    .map((node) => {
      if (node.type === 'text' || node.type === 'code') return node.value;
      if (node.type === 'mention') return `@${node.username}`;
      if (node.type === 'spoiler')
        return '▒'.repeat(Math.min(8, inlinePlain(node.children).length));
      return inlinePlain(node.children);
    })
    .join('');
}

/**
 * 멘션: @ 뒤의 GitHub 사용자 ID (영문·숫자·가운데 -, 39자까지). 메일 주소(a@b.com)처럼 앞에 글자가 붙은 @는
 * 멘션이 아니다. 코드(`…`, 코드 블록) 안은 parseInline이 먼저 떼어 내므로 멘션이 되지 않는다.
 */
const MENTION = /(?<![\w.@])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)(?![\w-])/g;

function splitMentions(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(MENTION)) {
    const at = match.index;
    if (at > last) out.push({ type: 'text', value: text.slice(last, at) });
    out.push({ type: 'mention', username: match[1]!.toLowerCase() });
    last = at + match[0].length;
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out;
}

/** 글에서 멘션한 사용자 ID들 (소문자, 겹치지 않게) */
export function extractMentions(text: string): string[] {
  const found = new Set<string>();
  const visitInline = (nodes: Inline[]) => {
    for (const node of nodes) {
      if (node.type === 'mention') found.add(node.username);
      else if (node.type !== 'text' && node.type !== 'code') visitInline(node.children);
    }
  };
  const visitBlock = (block: Block) => {
    if (block.type === 'paragraph' || block.type === 'heading') visitInline(block.children);
    else if (block.type === 'quote') block.children.forEach(visitBlock);
    else if (block.type === 'list') block.items.forEach(visitInline);
  };
  parseMarkdown(text).forEach(visitBlock);
  return [...found];
}
