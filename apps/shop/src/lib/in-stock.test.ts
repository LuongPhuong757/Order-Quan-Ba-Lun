import { describe, expect, it } from 'vitest';
import { inStockGroups } from './in-stock.ts';

const item = (id: string, out = false) => ({ id, is_out_of_stock: out });

describe('inStockGroups', () => {
  it('bỏ món tạm hết, giữ nguyên thứ tự món còn lại', () => {
    const out = inStockGroups([{ code: 'LAU', items: [item('a'), item('b', true), item('c')] }]);
    expect(out).toEqual([{ code: 'LAU', items: [item('a'), item('c')] }]);
  });

  it('nhóm hết SẠCH món thì bỏ luôn cả nhóm', () => {
    const out = inStockGroups([
      { code: 'LAU', items: [item('a', true), item('b', true)] },
      { code: 'NUONG', items: [item('c')] },
    ]);
    expect(out.map((g) => g.code)).toEqual(['NUONG']);
  });

  it('không sửa mảng gốc — giỏ hàng vẫn cần menu đầy đủ để biết món nào vừa hết', () => {
    const groups = [{ code: 'LAU', items: [item('a'), item('b', true)] }];
    inStockGroups(groups);
    expect(groups[0]!.items).toHaveLength(2);
  });

  it('menu rỗng thì trả mảng rỗng', () => {
    expect(inStockGroups([])).toEqual([]);
  });
});
