// Phát lại chuỗi giá sau khi sửa phiếu (2026-09-07). Không cần MySQL — `replayPrices` là thuần.
import { describe, expect, it } from 'vitest';
import { replayPrices } from './price-replay.js';
import type { ReplayDelivery, ReplayLine } from './price-replay.js';

const NO_THRESHOLDS = new Map<string, number | null>();
const ACTOR = 'u-admin';

/** Một dòng "thịt bò" giá `price` đ trên đơn vị gốc. `qty_base_per_unit` mặc định 1000 (mua KG,
 *  lưu gram) — đúng hình dạng dữ liệu thật sau bản vá đơn vị. */
function line(id: string, price: number, over: Partial<ReplayLine> = {}): ReplayLine {
  return {
    id,
    ingredient_id: 'thit-bo',
    ingredient_name: 'Thịt Bò',
    base_unit: 'g',
    purchase_unit: 'KG',
    qty_base_per_unit: '1000',
    unit_price: price * 1000,
    unit_price_base: String(price),
    price_approved_by_user_id: null,
    ...over,
  };
}

function delivery(id: string, date: string, lines: ReplayLine[]): ReplayDelivery {
  return { id, delivery_date: date, lines };
}

describe('replayPrices — dựng lại "giá lần trước" và "% biến động"', () => {
  it('lần nhập ĐẦU của một mặt hàng không có gì để so (M3.D-25)', () => {
    const r = replayPrices([delivery('d1', '2026-09-01', [line('l1', 100)])], NO_THRESHOLDS, ACTOR);
    expect(r.line_patches.get('l1')).toEqual({
      prev_unit_price_base: null,
      price_change_pct: null,
      prev_qty_base_per_unit: null,
      price_approved_by_user_id: null,
    });
    expect(r.flagged.size).toBe(0);
  });

  it('mỗi dòng so với lần giao TRƯỚC nó, không phải với bảng giá hiện tại', () => {
    const r = replayPrices(
      [
        delivery('d1', '2026-09-01', [line('l1', 100)]),
        delivery('d2', '2026-09-03', [line('l2', 105)]),
        delivery('d3', '2026-09-05', [line('l3', 210)]),
      ],
      NO_THRESHOLDS,
      ACTOR,
    );
    expect(r.line_patches.get('l2')?.prev_unit_price_base).toBe('100');
    expect(r.line_patches.get('l2')?.price_change_pct).toBe('5');
    expect(r.line_patches.get('l3')?.prev_unit_price_base).toBe('105');
    expect(r.line_patches.get('l3')?.price_change_pct).toBe('100');
  });

  it('SỬA phiếu giữa chuỗi kéo theo biến động giá của phiếu SAU nó', () => {
    // Chuỗi gốc: 100 → 105 (+5%). Sửa phiếu giữa từ 105 thành 200 thì phiếu cuối (210) phải
    // chuyển từ "+100% so với 105" sang "+5% so với 200". Đây chính là lý do phải phát lại cả
    // chuỗi chứ không chỉ tính lại phiếu vừa sửa.
    const sua = replayPrices(
      [
        delivery('d1', '2026-09-01', [line('l1', 100)]),
        delivery('d2', '2026-09-03', [line('l2', 200)]),
        delivery('d3', '2026-09-05', [line('l3', 210)]),
      ],
      NO_THRESHOLDS,
      ACTOR,
    );
    expect(sua.line_patches.get('l2')?.price_change_pct).toBe('100');
    expect(sua.line_patches.get('l3')?.prev_unit_price_base).toBe('200');
    expect(sua.line_patches.get('l3')?.price_change_pct).toBe('5');
  });

  it('thứ tự là NGÀY GIAO, nên nhập bù phiếu hôm qua nằm đúng chỗ của hôm qua', () => {
    // Caller sắp theo ngày giao; hàm chỉ đi theo thứ tự đó. Phiếu ngày 02 nằm giữa 01 và 05.
    const r = replayPrices(
      [
        delivery('d1', '2026-09-01', [line('l1', 100)]),
        delivery('bu', '2026-09-02', [line('l-bu', 150)]),
        delivery('d3', '2026-09-05', [line('l3', 160)]),
      ],
      NO_THRESHOLDS,
      ACTOR,
    );
    expect(r.line_patches.get('l-bu')?.prev_unit_price_base).toBe('100');
    expect(r.line_patches.get('l3')?.prev_unit_price_base).toBe('150');
    expect(r.refs.get('thit-bo')?.last_delivery_date).toBe('2026-09-05');
  });

  it('bảng giá tham chiếu = trạng thái CUỐI chuỗi', () => {
    const r = replayPrices(
      [
        delivery('d1', '2026-09-01', [line('l1', 100)]),
        delivery('d2', '2026-09-03', [line('l2', 120, { purchase_unit: 'G', qty_base_per_unit: '1' })]),
      ],
      NO_THRESHOLDS,
      ACTOR,
    );
    expect(r.refs.get('thit-bo')).toEqual({
      purchase_unit: 'G',
      qty_base_per_unit: '1',
      last_unit_price: 120000,
      last_unit_price_base: '120',
      last_delivery_date: '2026-09-03',
    });
  });

  it('mặt hàng bị BỎ khỏi phiếu lúc sửa thì vắng mặt ở bảng giá — caller phải xoá dòng đó', () => {
    const ca = line('l1', 50, { ingredient_id: 'ca-chua', ingredient_name: 'Cà Chua' });
    const r = replayPrices(
      [delivery('d1', '2026-09-01', [line('l0', 100)]), delivery('d2', '2026-09-03', [ca])],
      NO_THRESHOLDS,
      ACTOR,
    );
    // Thịt bò vẫn còn ở phiếu d1 nên vẫn có mốc; cà chua có mốc riêng.
    expect([...r.refs.keys()].sort()).toEqual(['ca-chua', 'thit-bo']);
    // Không phiếu nào còn "hành lá" → không có mốc, caller xoá dòng bảng giá của nó.
    expect(r.refs.has('hanh-la')).toBe(false);
  });
});

describe('replayPrices — dòng chờ duyệt giá', () => {
  it('vượt ngưỡng thì xếp vào danh sách chờ duyệt, kèm phiếu nào', () => {
    const r = replayPrices(
      [
        delivery('d1', '2026-09-01', [line('l1', 100)]),
        delivery('d2', '2026-09-03', [line('l2', 150)]), // +50% → strict
      ],
      NO_THRESHOLDS,
      ACTOR,
    );
    expect(r.flagged.get('d1')).toBeUndefined();
    const mine = r.flagged.get('d2')!;
    expect(mine).toHaveLength(1);
    expect(mine[0].price_change_pct).toBe('50');
    expect(mine[0].level).toBe('strict');
    expect(mine[0].prev_unit_price).toBe(100000);
  });

  it('đóng dấu người duyệt lên dòng lệch giá, và XOÁ dấu khi dòng hết lệch', () => {
    // Dòng l2 đang mang dấu duyệt cũ. Sau khi sửa, giá về đúng bằng lần trước → hết lệch →
    // dấu phải bị xoá, vì cột đó nghĩa là "đã có người cân nhắc mức giá này".
    const r = replayPrices(
      [
        delivery('d1', '2026-09-01', [line('l1', 100)]),
        delivery('d2', '2026-09-03', [line('l2', 100, { price_approved_by_user_id: 'u-cu' })]),
        delivery('d3', '2026-09-05', [line('l3', 300, { price_approved_by_user_id: 'u-cu' })]),
      ],
      NO_THRESHOLDS,
      ACTOR,
    );
    expect(r.line_patches.get('l2')?.price_approved_by_user_id).toBeNull();
    // Dòng còn lệch thì GIỮ người duyệt cũ, không đổi sang người đang sửa.
    expect(r.line_patches.get('l3')?.price_approved_by_user_id).toBe('u-cu');
  });

  it('dòng lệch giá chưa ai duyệt thì đóng dấu người đang sửa', () => {
    const r = replayPrices(
      [
        delivery('d1', '2026-09-01', [line('l1', 100)]),
        delivery('d2', '2026-09-03', [line('l2', 300)]),
      ],
      NO_THRESHOLDS,
      ACTOR,
    );
    expect(r.line_patches.get('l2')?.price_approved_by_user_id).toBe(ACTOR);
  });

  it('ngưỡng riêng của mặt hàng được tôn trọng (M3.D-23)', () => {
    const chain = [
      delivery('d1', '2026-09-01', [line('l1', 100)]),
      delivery('d2', '2026-09-03', [line('l2', 115)]), // +15%
    ];
    // Ngưỡng mặc định 10% → 15% là 'warn'. Nới lên 20% → hết cảnh báo.
    expect(replayPrices(chain, NO_THRESHOLDS, ACTOR).flagged.get('d2')?.[0].level).toBe('warn');
    expect(replayPrices(chain, new Map([['thit-bo', 20]]), ACTOR).flagged.get('d2')).toBeUndefined();
  });

  it('đổi cỡ đóng gói được nói rõ để popup không bị hiểu là tính sai (M3.D-37)', () => {
    const r = replayPrices(
      [
        delivery('d1', '2026-09-01', [line('l1', 100, { qty_base_per_unit: '1000' })]),
        // Giá/đơn vị gốc tăng 25% vì "thùng" rút từ 1000 xuống 800, giá thùng không đổi.
        delivery('d2', '2026-09-03', [line('l2', 125, { qty_base_per_unit: '800' })]),
      ],
      NO_THRESHOLDS,
      ACTOR,
    );
    expect(r.flagged.get('d2')?.[0].pack_size_changed).toBe(true);
    expect(r.flagged.get('d2')?.[0].prev_qty_base_per_unit).toBe('1000');
  });
});
