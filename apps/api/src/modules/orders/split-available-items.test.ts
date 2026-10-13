import { describe, expect, it } from 'vitest';
import { splitAvailable, type MenuItemLike, type RequestLineLike } from './split-available-items.js';

// M7.D-10 — nhân viên bấm MỘT nút duyệt cả lượt. M7.R5 — món hết giữa lúc chờ thì bỏ dòng đó
// và đổ phần còn lại, KHÔNG chặn cả lượt (chặn cả lượt là bắt khách gọi lại từ đầu chỉ vì một món).
//
// ── Vì sao hàm này phải chạy TRƯỚC addItemsBulk ──
// `addItemsBulk` FAIL-FAST (orders.service.ts:687-698): có một món hết là ném CONFLICT cho CẢ
// mảng. Đẩy nguyên lượt khách vào đó rồi bắt lỗi là hỏng cả lượt. Phải lọc sạch trước khi gọi.

const line = (id: string, over: Partial<RequestLineLike> = {}): RequestLineLike => ({
  menu_item_id: id,
  menu_item_name: `Món ${id}`,
  qty: 1,
  note: null,
  ...over,
});

const menu = (over: Partial<MenuItemLike> = {}): MenuItemLike => ({
  name: 'Phở bò',
  is_active: true,
  is_out_of_stock: false,
  ...over,
});

describe('splitAvailable — đường thông thường', () => {
  it('mọi món còn bán → ok đủ, skipped rỗng', () => {
    const r = splitAvailable([line('a'), line('b')], new Map([['a', menu()], ['b', menu()]]));
    expect(r.ok.map((l) => l.menu_item_id)).toEqual(['a', 'b']);
    expect(r.skipped).toEqual([]);
  });

  it('giữ nguyên qty và note của khách', () => {
    const r = splitAvailable([line('a', { qty: 3, note: 'ít cay' })], new Map([['a', menu()]]));
    expect(r.ok[0]).toMatchObject({ qty: 3, note: 'ít cay' });
  });
});

describe('splitAvailable — ba lý do bị bỏ', () => {
  it('món hết hàng → OUT_OF_STOCK, không nằm trong ok', () => {
    const r = splitAvailable([line('a')], new Map([['a', menu({ is_out_of_stock: true })]]));
    expect(r.ok).toEqual([]);
    expect(r.skipped).toEqual([{ menu_item_id: 'a', menu_item_name: 'Phở bò', reason: 'OUT_OF_STOCK' }]);
  });

  it('món bị tắt → GONE', () => {
    const r = splitAvailable([line('a')], new Map([['a', menu({ is_active: false })]]));
    expect(r.skipped[0]).toMatchObject({ reason: 'GONE' });
  });

  it('món đã xoá khỏi menu → GONE, tên lấy từ SNAPSHOT của lượt gọi', () => {
    const r = splitAvailable([line('a', { menu_item_name: 'Chả cá Lã Vọng' })], new Map());
    expect(r.skipped[0]).toEqual({
      menu_item_id: 'a',
      menu_item_name: 'Chả cá Lã Vọng',
      reason: 'GONE',
    });
  });
});

describe('splitAvailable — lượt hỗn hợp', () => {
  it('một món hết thì phần còn lại vẫn đổ được (M7.R5)', () => {
    const r = splitAvailable(
      [line('a'), line('b'), line('c')],
      new Map([['a', menu()], ['b', menu({ is_out_of_stock: true })], ['c', menu()]]),
    );
    expect(r.ok.map((l) => l.menu_item_id)).toEqual(['a', 'c']);
    expect(r.skipped.map((s) => s.menu_item_id)).toEqual(['b']);
  });
});

describe('splitAvailable — ca MỌI món đều hỏng', () => {
  it('ok RỖNG — caller phải biết để KHÔNG gọi addItemsBulk', () => {
    // addItemsBulk ném 'Giỏ hàng trống' khi mảng rỗng (orders.service.ts:657). Lượt này phải
    // kết thúc ở trạng thái REJECTED kèm skipped đủ 100%, không đi tiếp xuống bếp.
    const r = splitAvailable(
      [line('a'), line('b')],
      new Map([['a', menu({ is_out_of_stock: true })], ['b', menu({ is_active: false })]]),
    );
    expect(r.ok).toEqual([]);
    expect(r.skipped).toHaveLength(2);
  });
});
