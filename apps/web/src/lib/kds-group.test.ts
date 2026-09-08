import { describe, expect, it } from 'vitest';
import { groupByItem, groupByTable, type GroupableItem } from './kds-group.ts';

const T0 = 1_700_000_000_000;

const it_ = (over: Partial<GroupableItem> = {}): GroupableItem => ({
  id: Math.random().toString(36).slice(2),
  menu_item_id: 'm-ngo',
  menu_item_name: 'NGÔ CHIÊN',
  qty: 1,
  created_at: T0,
  table_code: 'B10',
  table_name: 'Bàn 10',
  ...over,
});

describe('groupByItem — gộp món để bếp nấu 1 lượt', () => {
  it('cùng menu_item_id ở nhiều bàn → 1 khối, cộng đúng SỐ PHẦN chứ không đếm dòng', () => {
    const g = groupByItem([
      it_({ qty: 2, table_code: 'B10', table_name: 'Bàn 10' }),
      it_({ qty: 3, table_code: 'B03', table_name: 'Bàn 3' }),
      it_({ qty: 2, table_code: 'B07', table_name: 'Bàn 7' }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].title).toBe('NGÔ CHIÊN');
    expect(g[0].qty).toBe(7);
    expect(g[0].items).toHaveLength(3);
    expect(g[0].subtitle).toBe('Bàn 10 ×2 · Bàn 3 ×3 · Bàn 7 ×2');
  });

  it('cùng bàn gọi món đó 2 lần → dòng phụ cộng lại chỗ bàn đó, không hiện 2 lần', () => {
    const g = groupByItem([
      it_({ qty: 1, created_at: T0 }),
      it_({ qty: 2, created_at: T0 + 60_000 }),
    ]);
    expect(g[0].subtitle).toBe('Bàn 10 ×3');
    expect(g[0].items).toHaveLength(2);
  });

  it('món khác nhau KHÔNG được dồn vào nhau', () => {
    const g = groupByItem([
      it_({ menu_item_id: 'm-ngo', menu_item_name: 'NGÔ CHIÊN' }),
      it_({ menu_item_id: 'm-nem', menu_item_name: 'NEM CHUA RÁN' }),
    ]);
    expect(g).toHaveLength(2);
  });

  it('món đã xoá khỏi menu (menu_item_id NULL) gộp theo TÊN, không dồn hết vào một khối', () => {
    const g = groupByItem([
      it_({ menu_item_id: null, menu_item_name: 'MÓN CŨ A' }),
      it_({ menu_item_id: null, menu_item_name: 'MÓN CŨ B' }),
      it_({ menu_item_id: null, menu_item_name: 'MÓN CŨ A' }),
    ]);
    expect(g).toHaveLength(2);
    expect(g.find((x) => x.title === 'MÓN CŨ A')?.items).toHaveLength(2);
  });

  it('ghi chú gộp theo nội dung — yêu cầu khác nhau không được nhập chung', () => {
    const g = groupByItem([
      it_({ is_note: true, menu_item_id: null, menu_item_name: 'lấy bát cho khách', qty: 1 }),
      it_({ is_note: true, menu_item_id: null, menu_item_name: 'thêm đá', qty: 1, table_code: 'B03', table_name: 'Bàn 3' }),
      it_({ is_note: true, menu_item_id: null, menu_item_name: 'lấy bát cho khách', qty: 1, table_code: 'B07', table_name: 'Bàn 7' }),
    ]);
    expect(g).toHaveLength(2);
    expect(g.find((x) => x.title === 'lấy bát cho khách')?.items).toHaveLength(2);
  });

  it('nhóm có món ⭐ ưu tiên lên đầu, dù gọi muộn hơn', () => {
    const g = groupByItem([
      it_({ menu_item_id: 'm-cu', menu_item_name: 'GỌI TRƯỚC', created_at: T0 }),
      it_({ menu_item_id: 'm-uu', menu_item_name: 'ƯU TIÊN', created_at: T0 + 600_000, is_priority: true }),
    ]);
    expect(g.map((x) => x.title)).toEqual(['ƯU TIÊN', 'GỌI TRƯỚC']);
  });

  it('nhóm NHIỀU PHẦN nhất lên đầu, dù gọi muộn hơn', () => {
    const g = groupByItem([
      it_({ menu_item_id: 'm-cu', menu_item_name: 'ÍT NHƯNG GỌI SỚM', qty: 1, created_at: T0 }),
      it_({ menu_item_id: 'm-nhieu', menu_item_name: 'NHIỀU', qty: 4, created_at: T0 + 600_000 }),
      it_({ menu_item_id: 'm-vua', menu_item_name: 'VỪA', qty: 2, created_at: T0 + 300_000 }),
    ]);
    expect(g.map((x) => x.title)).toEqual(['NHIỀU', 'VỪA', 'ÍT NHƯNG GỌI SỚM']);
    expect(g.map((x) => x.qty)).toEqual([4, 2, 1]);
  });

  it('số phần cộng dồn nhiều dòng cũng tính — 3 dòng ×1 thắng 1 dòng ×2', () => {
    const g = groupByItem([
      it_({ menu_item_id: 'm-doi', menu_item_name: 'MỘT DÒNG ×2', qty: 2, created_at: T0 }),
      it_({ menu_item_id: 'm-ba', menu_item_name: 'BA DÒNG ×1', qty: 1, created_at: T0 + 1000 }),
      it_({ menu_item_id: 'm-ba', menu_item_name: 'BA DÒNG ×1', qty: 1, created_at: T0 + 2000, table_code: 'B03', table_name: 'Bàn 3' }),
      it_({ menu_item_id: 'm-ba', menu_item_name: 'BA DÒNG ×1', qty: 1, created_at: T0 + 3000, table_code: 'B07', table_name: 'Bàn 7' }),
    ]);
    expect(g.map((x) => x.title)).toEqual(['BA DÒNG ×1', 'MỘT DÒNG ×2']);
  });

  it('CÙNG số phần → nhóm chờ lâu nhất lên đầu (oldest = created_at nhỏ nhất)', () => {
    const g = groupByItem([
      it_({ menu_item_id: 'm-moi', menu_item_name: 'MỚI', qty: 2, created_at: T0 + 600_000 }),
      it_({ menu_item_id: 'm-cu', menu_item_name: 'CŨ', qty: 2, created_at: T0 }),
    ]);
    expect(g.map((x) => x.title)).toEqual(['CŨ', 'MỚI']);
    expect(g[0].oldest).toBe(T0);
  });

  it('⭐ ưu tiên vẫn thắng số phần — khách sắp về thì nấu trước, dù chỉ 1 phần', () => {
    const g = groupByItem([
      it_({ menu_item_id: 'm-nhieu', menu_item_name: 'NHIỀU', qty: 9, created_at: T0 }),
      it_({ menu_item_id: 'm-uu', menu_item_name: 'ƯU TIÊN 1 PHẦN', qty: 1, created_at: T0 + 600_000, is_priority: true }),
    ]);
    expect(g.map((x) => x.title)).toEqual(['ƯU TIÊN 1 PHẦN', 'NHIỀU']);
  });

  it('danh sách rỗng → không nhóm nào', () => {
    expect(groupByItem([])).toEqual([]);
  });
});

describe('groupByTable — gộp theo bàn để ra món cùng lúc', () => {
  it('gộp bằng table_code, hiện bằng table_name', () => {
    const g = groupByTable([
      it_({ menu_item_name: 'NGÔ CHIÊN', qty: 2 }),
      it_({ menu_item_name: 'NEM CHUA RÁN', qty: 1 }),
      it_({ menu_item_name: 'KHOAI LANG KÉN', qty: 3, table_code: 'B03', table_name: 'Bàn 3' }),
    ]);
    expect(g).toHaveLength(2);
    const b10 = g.find((x) => x.title === 'Bàn 10')!;
    expect(b10.qty).toBe(3);
    expect(b10.subtitle).toBe('2 dòng · 3 phần');
  });

  it('hai bàn TRÙNG TÊN nhưng khác mã vẫn là 2 nhóm — không trộn món của 2 khách', () => {
    const g = groupByTable([
      it_({ table_code: 'B01', table_name: 'Bàn anh Long' }),
      it_({ table_code: 'B02', table_name: 'Bàn anh Long' }),
    ]);
    expect(g).toHaveLength(2);
  });

  it('KHÔNG sắp theo số phần — bàn nhiều món không gấp hơn bàn ngồi chờ lâu', () => {
    const g = groupByTable([
      it_({ table_code: 'B01', table_name: 'Bàn ít, chờ lâu', qty: 1, created_at: T0 }),
      it_({ table_code: 'B02', table_name: 'Bàn nhiều, mới gọi', qty: 9, created_at: T0 + 600_000 }),
    ]);
    expect(g.map((x) => x.title)).toEqual(['Bàn ít, chờ lâu', 'Bàn nhiều, mới gọi']);
  });

  it('bàn có món ⭐ ưu tiên lên đầu', () => {
    const g = groupByTable([
      it_({ table_code: 'B01', table_name: 'Bàn 1', created_at: T0 }),
      it_({ table_code: 'B02', table_name: 'Bàn 2', created_at: T0 + 600_000, is_priority: true }),
    ]);
    expect(g.map((x) => x.title)).toEqual(['Bàn 2', 'Bàn 1']);
  });
});
