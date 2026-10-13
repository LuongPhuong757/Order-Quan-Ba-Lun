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

// Chủ quán chốt 2026-10-13: đơn MANG VỀ / SHIP thì khách không ngồi lại, đồ xong là khách cầm
// đi — nên nhắc sau 1 TIẾNG kể từ lúc bếp làm xong món cuối, không đợi tới ngưỡng tính từ lúc mở.
describe('pickStaleUnpaid — mang về / ship nhắc sau 1 tiếng khi món đã xong', () => {
  const doneAgo = (min: number) => NOW - min * MIN;

  it('mang về xong được 60 phút → báo dù mở chưa tới ngưỡng', () => {
    const out = pickStaleUnpaid(
      [row('1', 70, { table_kind: 'takeaway', done_ms: doneAgo(60) })],
      NOW,
      180,
    );
    expect(out).toHaveLength(1);
    expect(out[0].reason).toBe('done');
    expect(out[0].done_age_ms).toBe(60 * MIN);
  });

  it('ship xong mới 59 phút → chưa báo', () => {
    const out = pickStaleUnpaid(
      [row('1', 70, { table_kind: 'delivery', done_ms: doneAgo(59) })],
      NOW,
      180,
    );
    expect(out).toEqual([]);
  });

  it('mang về còn món chưa xong (done_ms null) → không báo theo luật 1 tiếng', () => {
    const out = pickStaleUnpaid([row('1', 90, { table_kind: 'takeaway', done_ms: null })], NOW, 180);
    expect(out).toEqual([]);
  });

  it('mang về chưa xong nhưng đã mở quá ngưỡng chung → vẫn báo (lưới an toàn)', () => {
    const out = pickStaleUnpaid([row('1', 200, { table_kind: 'takeaway', done_ms: null })], NOW, 180);
    expect(out[0].reason).toBe('open');
  });

  it('bàn TẠI CHỖ món xong 2 tiếng vẫn KHÔNG báo — khách còn ngồi, giữ luật cũ', () => {
    const out = pickStaleUnpaid([row('1', 150, { table_kind: 'dine-in', done_ms: doneAgo(120) })], NOW, 180);
    expect(out).toEqual([]);
  });

  it('chủ quán tắt cảnh báo (ngưỡng 0) thì mang về cũng không báo', () => {
    const out = pickStaleUnpaid([row('1', 90, { table_kind: 'takeaway', done_ms: doneAgo(80) })], NOW, 0);
    expect(out).toEqual([]);
  });

  it('done_ms dạng STRING từ mysql2 vẫn tính đúng', () => {
    const out = pickStaleUnpaid(
      [row('1', 90, { table_kind: 'takeaway', done_ms: String(doneAgo(61)) })],
      NOW,
      180,
    );
    expect(out[0].done_age_ms).toBe(61 * MIN);
  });
});
