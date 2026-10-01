import { describe, expect, it } from 'vitest';
import { BLINK_AFTER_MS, buildGuestCards, type PendingPayload } from './kds-guest-cards.js';

// M7.R7 — rủi ro CAO: nhân viên QUÊN duyệt thì khách ngồi chờ món không bao giờ xuống bếp.
// Đồng hồ chờ + nhấp nháy sau 3 phút là chốt chặn duy nhất, nên ngưỡng phải có test.

const NOW = 1_700_000_000_000;
const payload = (over: Partial<PendingPayload> = {}): PendingPayload => ({
  requests: [
    {
      id: 'r1',
      order_id: 'o1',
      table_code: 'B05',
      table_name: 'Bàn 5',
      created_at: NOW - 60_000,
      items: [
        { menu_item_id: 'm1', name: 'Phở bò', qty: 2, note: 'ít cay', price_now: 50_000, out_of_stock: false },
      ],
      total_now: 100_000,
    },
  ],
  calls: [],
  ...over,
});

describe('buildGuestCards — dữ liệu thẻ duyệt', () => {
  it('dựng đúng tên bàn, tuổi lượt, dòng món', () => {
    const [c] = buildGuestCards(payload(), NOW);
    expect(c!.table_name).toBe('Bàn 5');
    expect(c!.ageMs).toBe(60_000);
    expect(c!.lines[0]).toMatchObject({ qty: 2, name: 'Phở bò', note: 'ít cay', gone: false });
  });

  it('tạm tính theo giá HIỆN TẠI (M7.D-11)', () => {
    const [c] = buildGuestCards(payload(), NOW);
    expect(c!.subtotal).toBe(100_000);
  });
});

describe('buildGuestCards — nhấp nháy sau 3 phút (R7)', () => {
  it('179 giây chưa nháy', () => {
    const p = payload();
    p.requests[0]!.created_at = NOW - 179_000;
    expect(buildGuestCards(p, NOW)[0]!.blink).toBe(false);
  });

  it('181 giây thì nháy', () => {
    const p = payload();
    p.requests[0]!.created_at = NOW - 181_000;
    expect(buildGuestCards(p, NOW)[0]!.blink).toBe(true);
  });

  it('đúng mốc 180 giây là bắt đầu nháy', () => {
    const p = payload();
    p.requests[0]!.created_at = NOW - BLINK_AFTER_MS;
    expect(buildGuestCards(p, NOW)[0]!.blink).toBe(true);
  });
});

describe('buildGuestCards — món hết hàng (R5)', () => {
  it('đánh dấu gone và KHÔNG cộng vào tạm tính', () => {
    const p = payload();
    p.requests[0]!.items.push({
      menu_item_id: 'm2', name: 'Chả cá', qty: 1, note: null, price_now: 85_000, out_of_stock: true,
    });
    p.requests[0]!.total_now = 100_000; // BE đã loại dòng hết khỏi tổng
    const [c] = buildGuestCards(p, NOW);
    expect(c!.lines[1]).toMatchObject({ name: 'Chả cá', gone: true });
    expect(c!.subtotal).toBe(100_000);
  });
});

describe('buildGuestCards — KHÔNG được ném (nhịp poll không được chết)', () => {
  it('payload undefined → mảng rỗng', () => {
    expect(buildGuestCards(undefined, NOW)).toEqual([]);
  });

  it('payload rác → mảng rỗng, không ném', () => {
    expect(buildGuestCards({ requests: null } as unknown as PendingPayload, NOW)).toEqual([]);
  });

  it('một lượt hỏng không làm hỏng các lượt khác', () => {
    const p = payload();
    p.requests.unshift({ id: 'bad' } as never);
    const cards = buildGuestCards(p, NOW);
    expect(cards.some((c) => c.table_name === 'Bàn 5')).toBe(true);
  });
});
