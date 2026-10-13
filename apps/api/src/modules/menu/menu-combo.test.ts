import { describe, expect, it } from 'vitest';
import { cleanItemIds } from './menu-combo.js';

const ids = new Set(['a', 'b', 'c']);

describe('cleanItemIds', () => {
  it('bỏ id không tồn tại và id trùng, giữ thứ tự', () => {
    expect(cleanItemIds(['c', 'x', 'a', 'c', 'b'], ids)).toEqual(['c', 'a', 'b']);
  });

  it('danh sách rỗng thì trả rỗng', () => {
    expect(cleanItemIds([], ids)).toEqual([]);
  });
});
