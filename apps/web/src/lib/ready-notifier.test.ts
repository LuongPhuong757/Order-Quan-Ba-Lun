import { beforeEach, describe, expect, it, vi } from 'vitest';

// api chỉ dùng cho B2 (tra nhật ký đơn) — giả lập để test không cần mạng.
const getMock = vi.fn();
vi.mock('./api.ts', () => ({ api: { get: (...a: unknown[]) => getMock(...a) } }));

import { ReadyNotifier, type ItemCancelByStaffEvent } from './ready-notifier.ts';

type It = { id: string; state: string; menu_item_name: string; qty: number; cancelled_reason?: string | null; cancelled_by_full_name?: string | null };
const don = (id: string, items: It[]) => ({ id, table_code: 'ban-05', table_name: 'Bàn 05', items });

describe('ReadyNotifier — báo bếp khi bớt / huỷ (B1, B2 test E2E 2026-11-10)', () => {
  let n: ReadyNotifier;
  let huy: ItemCancelByStaffEvent[];
  beforeEach(() => {
    n = new ReadyNotifier();
    huy = [];
    n.onItemCancelByStaff((e) => huy.push(e));
    getMock.mockReset();
  });

  it('B1: bớt lẻ phần món đang ở bếp → báo đúng số phần bị bớt, lấy người bớt từ dòng tách', () => {
    n.ingest([don('o1', [{ id: 'a', state: 'KITCHEN', menu_item_name: 'Nem', qty: 2 }])]);
    n.ingest([
      don('o1', [
        { id: 'a', state: 'KITCHEN', menu_item_name: 'Nem', qty: 1 },
        { id: 'b', state: 'CANCELLED', menu_item_name: 'Nem', qty: 1, cancelled_reason: 'Khách đổi ý', cancelled_by_full_name: 'Hằng' },
      ]),
    ]);
    expect(huy).toHaveLength(1);
    expect(huy[0]).toMatchObject({ menu_item_name: 'Nem', qty: 1, prev_state: 'KITCHEN', reason: 'Khách đổi ý', cancelled_by: 'Hằng' });
  });

  it('B1: tăng phần hoặc bớt món đã giao thì KHÔNG báo bếp', () => {
    n.ingest([don('o1', [{ id: 'a', state: 'KITCHEN', menu_item_name: 'Nem', qty: 2 }, { id: 's', state: 'SERVED', menu_item_name: 'Bia', qty: 3 }])]);
    n.ingest([don('o1', [{ id: 'a', state: 'KITCHEN', menu_item_name: 'Nem', qty: 3 }, { id: 's', state: 'SERVED', menu_item_name: 'Bia', qty: 1 }])]);
    expect(huy).toHaveLength(0);
  });

  it('B2: cả đơn biến mất khi còn món ở bếp + nhật ký kết thúc bằng HUỶ → báo từng món', async () => {
    n.ingest([don('o1', [{ id: 'a', state: 'COOKING', menu_item_name: 'Lẩu', qty: 1 }, { id: 'b', state: 'SERVED', menu_item_name: 'Bia', qty: 2 }])]);
    getMock.mockResolvedValue({ data: { data: { items: [{ event_kind: 'order_cancelled', created_at: 2, actor_name: 'Tuấn' }] } } });
    n.ingest([]);
    await vi.waitFor(() => expect(huy).toHaveLength(1));
    expect(getMock).toHaveBeenCalledWith('/orders/o1/activity');
    expect(huy[0]).toMatchObject({ menu_item_name: 'Lẩu', prev_state: 'COOKING', reason: 'Huỷ cả bàn', cancelled_by: 'Tuấn' });
  });

  it('B2: đơn biến mất vì THANH TOÁN → im lặng', async () => {
    n.ingest([don('o1', [{ id: 'a', state: 'KITCHEN', menu_item_name: 'Lẩu', qty: 1 }])]);
    getMock.mockResolvedValue({ data: { data: { items: [{ event_kind: 'order_cancelled', created_at: 1 }, { event_kind: 'checkout', created_at: 5 }] } } });
    n.ingest([]);
    await new Promise((r) => setTimeout(r, 10));
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(huy).toHaveLength(0);
  });

  it('B2: đơn biến mất mà không có món ở bếp → không tra nhật ký', () => {
    n.ingest([don('o1', [{ id: 'b', state: 'SERVED', menu_item_name: 'Bia', qty: 2 }])]);
    n.ingest([]);
    expect(getMock).not.toHaveBeenCalled();
  });
});
