import { describe, expect, it } from 'vitest';
import { resolveScheme } from './theme';

describe('색 모드', () => {
  it('기기 설정이면 OS를 따르고, 고르면 그대로', () => {
    expect(resolveScheme('system', true)).toBe('dark');
    expect(resolveScheme('system', false)).toBe('light');
    expect(resolveScheme('light', true)).toBe('light');
    expect(resolveScheme('dark', false)).toBe('dark');
  });
});
