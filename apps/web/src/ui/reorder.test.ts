import { describe, expect, it } from 'vitest';
import { reorder } from './reorder';

describe('reorder', () => {
  const ids = ['a', 'b', 'c', 'd'];

  it('대상의 앞이나 뒤로 옮긴다', () => {
    expect(reorder(ids, 'a', 'c', true)).toEqual(['b', 'c', 'a', 'd']);
    expect(reorder(ids, 'a', 'c', false)).toEqual(['b', 'a', 'c', 'd']);
    expect(reorder(ids, 'd', 'a', false)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('제자리이거나 모르는 항목이면 그대로', () => {
    expect(reorder(ids, 'b', 'b', true)).toEqual(ids);
    expect(reorder(ids, 'x', 'a', true)).toEqual(ids);
  });
});
