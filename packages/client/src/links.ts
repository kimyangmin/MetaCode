export type TextPart = { type: 'text'; value: string } | { type: 'link'; value: string };

/** http(s) 주소. 공백과 꺾쇠, 따옴표에서 끊는다 */
const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/g;
/** 주소 끝에 붙기 쉬운 문장 부호는 링크에 넣지 않는다 ("https://a.com." → 링크는 https://a.com) */
const TRAILING = /[.,!?;:)\]}'"…]+$/;

/**
 * 메시지 글을 글자와 링크로 나눈다. http와 https만 링크로 만든다 (javascript: 같은 주소는 글자로 남는다).
 * 화면은 이 결과를 React 요소로 그리므로 HTML이 끼어들 틈이 없다.
 */
export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = match[0];
    const url = raw.replace(TRAILING, '');
    const start = match.index;
    if (start > last) parts.push({ type: 'text', value: text.slice(last, start) });
    parts.push({ type: 'link', value: url });
    last = start + url.length;
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
  return parts;
}
