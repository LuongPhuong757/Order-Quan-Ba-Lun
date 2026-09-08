import { describe, expect, it } from 'vitest';
import { applyStickyOrder, groupByItem, groupByTable, type GroupableItem } from './kds-group.ts';

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

  it('nhóm có món ⭐ ưu tiên lên đầu — kể cả ở thứ tự A→Z, "Ư" đứng sau "G"', () => {
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
   ], 'qty');
    expect(g.map((x) => x.title)).toEqual(['NHIỀU', 'VỪA', 'ÍT NHƯNG GỌI SỚM']);
    expect(g.map((x) => x.qty)).toEqual([4, 2, 1]);
  });

  it('số phần cộng dồn nhiều dòng cũng tính — 3 dòng ×1 thắng 1 dòng ×2', () => {
    const g = groupByItem([
      it_({ menu_item_id: 'm-doi', menu_item_name: 'MỘT DÒNG ×2', qty: 2, created_at: T0 }),
      it_({ menu_item_id: 'm-ba', menu_item_name: 'BA DÒNG ×1', qty: 1, created_at: T0 + 1000 }),
      it_({ menu_item_id: 'm-ba', menu_item_name: 'BA DÒNG ×1', qty: 1, created_at: T0 + 2000, table_code: 'B03', table_name: 'Bàn 3' }),
      it_({ menu_item_id: 'm-ba', menu_item_name: 'BA DÒNG ×1', qty: 1, created_at: T0 + 3000, table_code: 'B07', table_name: 'Bàn 7' }),
   ], 'qty');
    expect(g.map((x) => x.title)).toEqual(['BA DÒNG ×1', 'MỘT DÒNG ×2']);
  });

  it('CÙNG số phần → nhóm chờ lâu nhất lên đầu (oldest = created_at nhỏ nhất)', () => {
    const g = groupByItem([
      it_({ menu_item_id: 'm-moi', menu_item_name: 'MỚI', qty: 2, created_at: T0 + 600_000 }),
      it_({ menu_item_id: 'm-cu', menu_item_name: 'CŨ', qty: 2, created_at: T0 }),
   ], 'qty');
    expect(g.map((x) => x.title)).toEqual(['CŨ', 'MỚI']);
    expect(g[0].oldest).toBe(T0);
  });

  it('⭐ ưu tiên vẫn thắng số phần — khách sắp về thì nấu trước, dù chỉ 1 phần', () => {
    const g = groupByItem([
      it_({ menu_item_id: 'm-nhieu', menu_item_name: 'NHIỀU', qty: 9, created_at: T0 }),
      it_({ menu_item_id: 'm-uu', menu_item_name: 'ƯU TIÊN 1 PHẦN', qty: 1, created_at: T0 + 600_000, is_priority: true }),
   ], 'qty');
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

  it('mặc định A→Z, KHÔNG theo số phần — thứ tự này không đổi khi bếp làm xong dòng nào', () => {
    const g = groupByTable([
      it_({ table_code: 'B02', table_name: 'Ship 10', qty: 9 }),
      it_({ table_code: 'B01', table_name: 'Ship 02', qty: 1 }),
      it_({ table_code: 'B03', table_name: 'Ship 09', qty: 3 }),
    ]);
    // numeric:true → "Ship 02" trước "Ship 09" trước "Ship 10" (không phải so chuỗi thô)
    expect(g.map((x) => x.title)).toEqual(['Ship 02', 'Ship 09', 'Ship 10']);
  });

  it("order 'qty' thì bàn nhiều phần nhất lên đầu", () => {
    const g = groupByTable([
      it_({ table_code: 'B01', table_name: 'Ship 02', qty: 1 }),
      it_({ table_code: 'B02', table_name: 'Ship 10', qty: 9 }),
    ], 'qty');
    expect(g.map((x) => x.title)).toEqual(['Ship 10', 'Ship 02']);
  });

  it('bàn có món ⭐ ưu tiên lên đầu', () => {
    const g = groupByTable([
      it_({ table_code: 'B01', table_name: 'Bàn 1', created_at: T0 }),
      it_({ table_code: 'B02', table_name: 'Bàn 2', created_at: T0 + 600_000, is_priority: true }),
    ]);
    expect(g.map((x) => x.title)).toEqual(['Bàn 2', 'Bàn 1']);
  });
});

describe('applyStickyOrder — nhóm không được tự nhảy chỗ dưới ngón tay bếp', () => {
  const g = (key: string, qty: number, oldest = T0, hasPriority = false) => ({
    key,
    title: key,
    subtitle: '',
    items: [] as GroupableItem[],
    qty,
    oldest,
    hasPriority,
  });

  it('lần đầu (chưa có thứ tự cũ) → dùng nguyên thứ tự sort', () => {
    const sorted = [g('a', 5), g('b', 3), g('c', 1)];
    expect(applyStickyOrder(sorted, []).map((x) => x.key)).toEqual(['a', 'b', 'c']);
  });

  it('nhóm đầu tụt số phần vẫn ĐỨNG YÊN — đây là cả lý do có hàm này', () => {
    // Bếp bấm xong 4/5 phần của nhóm 'a' → sort mới đẩy 'a' xuống cuối
    const sorted = [g('b', 3), g('c', 2), g('a', 1)];
    expect(applyStickyOrder(sorted, ['a', 'b', 'c']).map((x) => x.key)).toEqual(['a', 'b', 'c']);
  });

  it('nhóm làm xong hết thì rụng khỏi danh sách, các nhóm còn lại không đổi chỗ', () => {
    const sorted = [g('c', 2), g('b', 1)];
    expect(applyStickyOrder(sorted, ['a', 'b', 'c']).map((x) => x.key)).toEqual(['b', 'c']);
  });

  it('nhóm MỚI xuống cuối, không chen vào giữa việc đang làm — dù nhiều phần hơn', () => {
    const sorted = [g('moi', 9), g('a', 2), g('b', 1)];
    expect(applyStickyOrder(sorted, ['a', 'b']).map((x) => x.key)).toEqual(['a', 'b', 'moi']);
  });

  it('nhiều nhóm mới cùng lúc → xuống cuối theo đúng thứ tự sort', () => {
    const sorted = [g('m2', 9), g('m1', 4), g('a', 2)];
    expect(applyStickyOrder(sorted, ['a']).map((x) => x.key)).toEqual(['a', 'm2', 'm1']);
  });

  it('⭐ ưu tiên nổi lên đầu kể cả khi nó là nhóm mới', () => {
    const sorted = [g('uu', 1, T0, true), g('a', 5), g('b', 3)];
    expect(applyStickyOrder(sorted, ['a', 'b']).map((x) => x.key)).toEqual(['uu', 'a', 'b']);
  });

  it('nhóm đang ở giữa mà được bấm ⭐ thì nhảy lên đầu, không kẹt tại chỗ', () => {
    const sorted = [g('b', 3, T0, true), g('a', 5), g('c', 1)];
    expect(applyStickyOrder(sorted, ['a', 'b', 'c']).map((x) => x.key)).toEqual(['b', 'a', 'c']);
  });

  it('key trong thứ tự cũ không còn tồn tại thì bỏ qua, không sinh lỗ trống', () => {
    const sorted = [g('a', 1)];
    expect(applyStickyOrder(sorted, ['x', 'y', 'a', 'z'])).toHaveLength(1);
  });

  it('danh sách rỗng → rỗng', () => {
    expect(applyStickyOrder([], ['a', 'b'])).toEqual([]);
  });
});

describe("thứ tự mặc định A→Z (order 'az')", () => {
  it('sắp theo tên tiếng Việt — chữ có dấu không bị đẩy xuống cuối', () => {
    const g = groupByItem([
      it_({ menu_item_id: 'm3', menu_item_name: 'Oc Lan Luoc' }),
      it_({ menu_item_id: 'm1', menu_item_name: 'Ba Chi Nuong' }),
      it_({ menu_item_id: 'm2', menu_item_name: 'Nom Bo' }),
      it_({ menu_item_id: 'm4', menu_item_name: 'Ba Chi Nuong Muoi Ot' }),
    ]);
    expect(g.map((x) => x.title)).toEqual([
      'Ba Chi Nuong',
      'Ba Chi Nuong Muoi Ot',
      'Nom Bo',
      'Oc Lan Luoc',
    ]);
  });

  it('số trong tên so theo GIÁ TRỊ: "Ba Chỉ Nướng : 150" trước ": 200"', () => {
    const g = groupByItem([
      it_({ menu_item_id: 'a2', menu_item_name: 'Ba Chỉ Nướng : 200' }),
      it_({ menu_item_id: 'a1', menu_item_name: 'Ba Chỉ Nướng : 150' }),
    ]);
    expect(g.map((x) => x.title)).toEqual(['Ba Chỉ Nướng : 150', 'Ba Chỉ Nướng : 200']);
  });

  it('thứ tự A→Z KHÔNG đổi khi số phần đổi — đây là điểm chính của mặc định này', () => {
    const before = groupByItem([
      it_({ menu_item_id: 'a', menu_item_name: 'AAA', qty: 1 }),
      it_({ menu_item_id: 'b', menu_item_name: 'BBB', qty: 9 }),
    ]);
    const after = groupByItem([
      it_({ menu_item_id: 'a', menu_item_name: 'AAA', qty: 9 }),
      it_({ menu_item_id: 'b', menu_item_name: 'BBB', qty: 1 }),
    ]);
    expect(before.map((x) => x.title)).toEqual(after.map((x) => x.title));
  });
});
