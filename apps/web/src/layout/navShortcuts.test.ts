import { describe, expect, it } from 'vitest';
import { shortcutTarget } from './navShortcuts';

const key = (
  code: string,
  mods: Partial<Record<'ctrl' | 'shift' | 'alt' | 'meta', boolean>> = {},
) => ({
  code,
  ctrlKey: mods.ctrl ?? true,
  shiftKey: mods.shift ?? false,
  altKey: mods.alt ?? false,
  metaKey: mods.meta ?? false,
});

const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];

describe('shortcutTarget', () => {
  it('Ctrl+1은 DM', () => {
    expect(shortcutTarget(key('Digit1'), ids)).toBe('/dm');
    expect(shortcutTarget(key('Digit1'), [])).toBe('/dm');
  });

  it('Ctrl+2~9는 첫 번째~여덟 번째, Ctrl+0은 아홉 번째 커뮤니티', () => {
    expect(shortcutTarget(key('Digit2'), ids)).toBe('/c/a');
    expect(shortcutTarget(key('Digit9'), ids)).toBe('/c/h');
    expect(shortcutTarget(key('Digit0'), ids)).toBe('/c/i');
  });

  it('없는 커뮤니티나 다른 조합은 무시한다', () => {
    expect(shortcutTarget(key('Digit3'), ['a'])).toBeNull();
    expect(shortcutTarget(key('Digit2', { ctrl: false }), ids)).toBeNull();
    expect(shortcutTarget(key('Digit2', { shift: true }), ids)).toBeNull();
    expect(shortcutTarget(key('Digit2', { alt: true }), ids)).toBeNull();
    expect(shortcutTarget(key('Numpad2'), ids)).toBeNull();
    expect(shortcutTarget(key('KeyA'), ids)).toBeNull();
  });
});
