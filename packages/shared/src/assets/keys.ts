import { z } from 'zod';

/**
 * 에셋 매니페스트와 애니메이터가 함께 쓰는 이름 규칙. manifest.ts와 animator.ts가 서로를 불러오지 않게
 * 따로 둔다 (manifest.ts가 다시 내보낸다).
 */

/** 애니메이션·애니메이터 상태·파라미터 이름 (영문 소문자로 시작, 소문자·숫자·-) */
export const ASSET_NAME_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * 광장에서 누르는 키 (캐릭터 모션, 애니메이터 파라미터). 정해 둔 목록 없이 사용자가 에디터에서 누른 키를
 * 그대로 단다 (`inputKeyFromCode`, 자판 배열·한글 자판과 상관없이 자리 `KeyboardEvent.code`로 본다):
 * 숫자(위 줄·숫자 자판)는 `'1'`, 글자는 `'z'`, 그 밖에는 code 그대로(`'F2'`, `'Semicolon'`).
 * 예전에 단 키(숫자 1~0, 글자)도 같은 모양이라 그대로 쓴다.
 */
export type MotionKey = string;
export type ParameterKey = string;

const INPUT_KEY_PATTERN = /^(?:[0-9a-z]|[A-Z][A-Za-z0-9]{1,24})$/;

/**
 * 달 수 없는 키: 광장의 이동·점프·채팅(방향키, 스페이스, /), 창·포커스(Esc, Tab, Enter), 조합 키, 한/영 같은
 * 입력기 키, 브라우저가 쓰는 키(새로 고침, 전체 화면, 개발자 도구).
 */
const RESERVED_INPUT_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'Slash',
  'NumpadDivide',
  'Escape',
  'Tab',
  'Enter',
  'NumpadEnter',
  'Backspace',
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'OSLeft',
  'OSRight',
  'CapsLock',
  'ContextMenu',
  'Fn',
  'FnLock',
  'Lang1',
  'Lang2',
  'Convert',
  'NonConvert',
  'KanaMode',
  'NumLock',
  'ScrollLock',
  'Pause',
  'PrintScreen',
  'F5',
  'F11',
  'F12',
  'Unidentified',
]);

/** 키를 달 수 있는지 */
export function isAssignableKey(key: string): boolean {
  return INPUT_KEY_PATTERN.test(key) && !RESERVED_INPUT_KEYS.has(key);
}

/** 누른 키(KeyboardEvent.code)를 다는 모양으로. 달 수 없는 키면 null */
export function inputKeyFromCode(code: string): string | null {
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(code);
  if (digit) return digit[1]!;
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1]!.toLowerCase();
  return isAssignableKey(code) ? code : null;
}

/** 키 이름 (화면에 보일 글자) */
const KEY_LABELS: Record<string, string> = {
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  IntlBackslash: '\\',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num -',
  NumpadMultiply: 'Num *',
  NumpadDecimal: 'Num .',
  Insert: 'Ins',
  Delete: 'Del',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
};

export function inputKeyLabel(key: string): string {
  return KEY_LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}

/** 키 값 검증 (매니페스트, 애니메이터) */
export const inputKeySchema = z.string().refine(isAssignableKey, '달 수 없는 키입니다.');

/**
 * 새 모션·스킬에 처음 붙여 주는 키 (에디터에서 다른 키를 눌러 바꿀 수 있다). 광장의 모션 목록도 이 순서로,
 * 목록에 없는 키는 그 뒤에 이름 순서로 보인다.
 */
export const SUGGESTED_KEYS = [
  ...['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ...['z', 'x', 'c', 'v', 'a', 's', 'd', 'f', 'q', 'w', 'e', 'r'],
] as const;

/** 키 순서 (모션 목록) */
export function compareInputKeys(a: string, b: string): number {
  const order = (k: string) => {
    const i = (SUGGESTED_KEYS as readonly string[]).indexOf(k);
    return i === -1 ? SUGGESTED_KEYS.length : i;
  };
  return order(a) - order(b) || a.localeCompare(b);
}

export const MOTION_LABEL_MAX_LENGTH = 16;
