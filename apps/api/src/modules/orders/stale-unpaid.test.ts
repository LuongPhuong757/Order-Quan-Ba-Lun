// Unit test cho dải đỏ "bàn ngồi quá lâu chưa thanh toán" (chốt 2026-10-12) — hàm thuần, không DB.
//
// Điều kiện SQL (đơn mở, chưa thu tiền, còn món) nằm ở `OrdersService.listStaleUnpaid`; ở đây
// chỉ neo phần NGƯỠNG + THỨ TỰ + CHỮ HIỂN THỊ.
import { describe, expect, it } from 'vitest';
import { pickStaleUnpaid, type StaleUnpaidRow } from './stale-unpaid.js';

const NOW = Date.parse('2026-10-12T15:00:00Z');
const MIN = 60_000;

function row(id: string, openedMinAgo: number, extra: Partial<StaleUnpaidRow> = {}): StaleUnpaidRow {
  return {
    id,
    table_id: `t-${id}`,
    table_code: `ban-${id}`,
    table_name: `Bàn ${id}`,
    source: 'STAFF',
    customer_name: null,
    opened_ms: NOW - openedMinAgo * MIN,
    ...extra,
  };
}

describe('pickStaleUnpaid — ngưỡng chủ quán chỉnh', () => {
  it('mở quá ngưỡng → báo, chưa tới ngưỡng → không báo', () => {
    const out = pickStaleUnpaid([row('1', 200), row('2', 100)], NOW, 180);
    expect(out.map((o) => o.order_id)).toEqual(['1']);
  });

  it('đúng bằng ngưỡng là ĐÃ quá giờ', () => {
    expect(pickStaleUnpaid([row('1', 180)], NOW, 180)).toHaveLength(1);
  });

  it('ngưỡng 0 = chủ quán tắt cảnh báo → không báo gì dù bàn ngồi cả ngày', () => {
    expect(pickStaleUnpaid([row('1', 24 * 60)], NOW, 0)).toEqual([]);
  });

  it('bàn ngồi LÂU NHẤT đứng đầu', () => {
    const out = pickStaleUnpaid([row('a', 190), row('b', 400), row('c', 250)], NOW, 180);
    expect(out.map((o) => o.order_id)).toEqual(['b', 'c', 'a']);
  });

  it('mysql2 trả opened_ms dạng STRING vẫn tính đúng', () => {
    const out = pickStaleUnpaid([row('1', 200, { opened_ms: String(NOW - 200 * MIN) })], NOW, 180);
    expect(out[0].open_ms).toBe(200 * MIN);
  });
});

describe('pickStaleUnpaid — chữ trên dải đỏ', () => {
  it('đơn tại bàn hiện tên bàn', () => {
    expect(pickStaleUnpaid([row('1', 200)], NOW, 180)[0].label).toBe('Bàn 1');
  });

  it('bàn chưa đặt tên thì dùng mã bàn', () => {
    expect(pickStaleUnpaid([row('1', 200, { table_name: null })], NOW, 180)[0].label).toBe('ban-1');
  });

  it('đơn online kèm tên khách', () => {
    const out = pickStaleUnpaid([row('1', 200, { source: 'ONLINE', customer_name: 'Chị Hoa' })], NOW, 180);
    expect(out[0].label).toBe('Bàn 1 · Chị Hoa');
  });
});
