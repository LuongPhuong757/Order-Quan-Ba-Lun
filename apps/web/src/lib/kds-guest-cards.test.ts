import { describe, expect, it } from 'vitest';
import {
  BLINK_AFTER_MS,
  buildGuestCards,
  describeGroup,
  groupCallsByTable,
  type PendingCall,
  type PendingPayload,
} from './kds-guest-cards.js';

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
      auto_items: [],
      total_now: 100_000,
    },
  ],
  calls: [],
  ...over,
});

describe('buildGuestCards — dữ liệu thẻ duyệt', () => {
  it('khăn quán tự thêm hiện thành MỘT DÒNG RIÊNG có cờ auto, không lẫn vào món khách gọi', () => {
    const [c] = buildGuestCards(
      payload({
        requests: [
          {
            id: 'r1',
            order_id: 'o1',
            table_code: 'B05',
            table_name: 'Bàn 5',
            created_at: NOW,
            items: [
              { menu_item_id: 'm1', name: 'Phở bò', qty: 2, note: null, price_now: 50_000, out_of_stock: false },
            ],
            auto_items: [{ name: 'Khăn Lạnh', qty: 5, price_now: 3_000 }],
            total_now: 115_000,
          },
        ],
      }),
      NOW,
    );
    expect(c!.lines).toHaveLength(2);
    expect(c!.lines[0]!.auto).toBeUndefined();
    expect(c!.lines[1]).toMatchObject({ name: 'Khăn Lạnh', qty: 5, auto: true });
    // Tạm tính lấy thẳng `total_now` của server — server đã cộng khăn vào rồi.
    expect(c!.subtotal).toBe(115_000);
  });

  it('payload cũ không có auto_items → không ném, chỉ là không có dòng nào', () => {
    const [c] = buildGuestCards(
      { requests: [{ ...payload().requests[0]!, auto_items: undefined as never }], calls: [] },
      NOW,
    );
    expect(c!.lines).toHaveLength(1);
  });

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

describe('groupCallsByTable — một bàn một chip, để bàn ồn không đẩy bàn khác khỏi màn', () => {
  const call = (over: Partial<PendingCall>): PendingCall => ({
    id: 'c1', table_code: 'B05', table_name: 'Bàn 5', kind: 'STAFF',
    created_at: NOW, note: null, ...over,
  });

  it('ba lời nhắn của cùng một bàn gộp thành MỘT nhóm', () => {
    const g = groupCallsByTable([
      call({ id: 'c1', note: 'Thêm đá' }),
      call({ id: 'c2', note: 'Thêm giấy' }),
      call({ id: 'c3', kind: 'BILL' }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]!.items).toHaveLength(3);
    expect(g[0]!.has_staff).toBe(true);
    expect(g[0]!.has_bill).toBe(true);
  });

  it('gộp theo MÃ bàn, không theo tên — tên bàn đổi được giữa chừng', () => {
    const g = groupCallsByTable([
      call({ id: 'c1', table_code: 'B05', table_name: 'Bàn 5' }),
      call({ id: 'c2', table_code: 'B05', table_name: 'Bàn 5 (sân sau)' }),
    ]);
    expect(g).toHaveLength(1);
  });

  it('hai bàn khác nhau vẫn là hai nhóm, bàn chờ LÂU NHẤT đứng trước', () => {
    const g = groupCallsByTable([
      call({ id: 'a', table_code: 'B09', table_name: 'Bàn 9', created_at: NOW }),
      call({ id: 'b', table_code: 'B02', table_name: 'Bàn 2', created_at: NOW - 60_000 }),
    ]);
    expect(g.map((x) => x.table_code)).toEqual(['B02', 'B09']);
  });

  it('trong một nhóm, lời nhắn cũ xếp trước', () => {
    const g = groupCallsByTable([
      call({ id: 'moi', created_at: NOW }),
      call({ id: 'cu', created_at: NOW - 120_000 }),
    ]);
    expect(g[0]!.items.map((i) => i.id)).toEqual(['cu', 'moi']);
    expect(g[0]!.oldest_at).toBe(NOW - 120_000);
  });

  it('payload rác → mảng rỗng, không ném (vòng poll 2 giây không được chết)', () => {
    expect(groupCallsByTable(undefined)).toEqual([]);
    expect(groupCallsByTable(null)).toEqual([]);
    expect(groupCallsByTable([null as never, undefined as never])).toEqual([]);
  });

  it('describeGroup: một lời nhắn in thẳng lời đó, nhiều thì đếm', () => {
    expect(describeGroup(groupCallsByTable([call({ note: 'Thêm đá' })])[0]!)).toBe('💬 Thêm đá');
    expect(describeGroup(groupCallsByTable([call({})])[0]!)).toBe('gọi thêm đồ');
    expect(describeGroup(groupCallsByTable([call({ id: 'a' }), call({ id: 'b' })])[0]!)).toBe('2 lời nhắn');
  });
});
