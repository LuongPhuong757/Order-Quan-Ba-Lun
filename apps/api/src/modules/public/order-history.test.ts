import { describe, expect, it } from 'vitest';
import { PublicOrderHistoryEntry } from '@order/schemas';
import { STAGE_LABEL_CANCELLED_BY_CUSTOMER } from './order-progress.js';
import {
  buildHistoryEntry,
  type HistoryOrderItemRow,
  type HistoryRequestRow,
} from './order-history.js';

// Tra cứu lịch sử đơn theo SĐT (2026-08-04). Mỗi block bám 1 ranh giới ghi ở docblock
// order-history.ts — G-1/M2.D-23 (không state từng món), M2.D-47 (sau duyệt đọc order_items
// thật), M2.D-62 (subtotal là tiền món), nhãn khách-tự-huỷ khác nhãn quán-từ-chối.

function baseRequest(overrides: Partial<HistoryRequestRow> = {}): HistoryRequestRow {
  return {
    order_token: 'tok-1',
    status: 'WAITING',
    fulfillment_type: 'DELIVERY',
    submitted_at: 1_700_000_000_000,
    max_progress_shown: 0,
    subtotal: 90_000,
    items_snapshot: [
      { name: 'Lẩu bò', qty: 1, unit_price: 60_000 },
      { name: 'Trà đá', qty: 3, unit_price: 10_000 },
    ],
    order_id: null,
    ...overrides,
  };
}

function item(overrides: Partial<HistoryOrderItemRow> = {}): HistoryOrderItemRow {
  return {
    menu_item_name: 'Lẩu bò',
    menu_item_price: 60_000,
    qty: 1,
    state: 'COOKING',
    is_note: false,
    ...overrides,
  };
}

describe('buildHistoryEntry — đơn chưa duyệt (đọc items_snapshot)', () => {
  it('WAITING → stage RECEIVED, items từ snapshot (chỉ name+qty), subtotal từ request', () => {
    const entry = buildHistoryEntry(baseRequest(), null, []);
    expect(entry.stage).toBe('RECEIVED');
    expect(entry.stage_label).toBe('Đã tiếp nhận');
    expect(entry.items).toEqual([
      { name: 'Lẩu bò', qty: 1 },
      { name: 'Trà đá', qty: 3 },
    ]);
    expect(entry.subtotal).toBe(90_000);
  });

  it('khách tự huỷ → stage REJECTED nhưng nhãn là câu huỷ, KHÔNG phải "bị từ chối"', () => {
    const entry = buildHistoryEntry(baseRequest({ status: 'CANCELLED_BY_CUSTOMER' }), null, []);
    expect(entry.stage).toBe('REJECTED');
    expect(entry.stage_label).toBe(STAGE_LABEL_CANCELLED_BY_CUSTOMER);
  });

  it('quán từ chối → nhãn "Đơn đã bị từ chối"', () => {
    const entry = buildHistoryEntry(baseRequest({ status: 'REJECTED' }), null, []);
    expect(entry.stage_label).toBe('Đơn đã bị từ chối');
  });
});

describe('buildHistoryEntry — đơn đã duyệt (đọc order_items thật, M2.D-47)', () => {
  const confirmed = () => baseRequest({ status: 'CONFIRMED', order_id: 'ord-1' });

  it('items + subtotal tính từ order_items, KHÔNG dùng snapshot', () => {
    const entry = buildHistoryEntry(confirmed(), { shipped_at: null, received_at: null }, [
      item({ menu_item_name: 'Lẩu gà', menu_item_price: 250_000, qty: 1, state: 'READY' }),
      item({ menu_item_name: 'Bún', menu_item_price: 10_000, qty: 2, state: 'READY' }),
    ]);
    expect(entry.items).toEqual([
      { name: 'Lẩu gà', qty: 1 },
      { name: 'Bún', qty: 2 },
    ]);
    expect(entry.subtotal).toBe(270_000);
    expect(entry.stage).toBe('READY_TO_SHIP');
  });

  it('món huỷ/hết hàng bị loại khỏi items lẫn subtotal; dòng ghi chú (is_note) không phải món', () => {
    const entry = buildHistoryEntry(confirmed(), { shipped_at: null, received_at: null }, [
      item({ menu_item_name: 'Lẩu gà', menu_item_price: 250_000, state: 'COOKING' }),
      item({ menu_item_name: 'Món huỷ', menu_item_price: 99_000, state: 'CANCELLED' }),
      item({ menu_item_name: 'ít cay', menu_item_price: 0, is_note: true }),
    ]);
    expect(entry.items).toEqual([{ name: 'Lẩu gà', qty: 1 }]);
    expect(entry.subtotal).toBe(250_000);
  });

  it('received_at != null → COMPLETED, nhãn theo luồng (DELIVERY: "Đã nhận hàng")', () => {
    const entry = buildHistoryEntry(confirmed(), { shipped_at: 1, received_at: 2 }, [
      item({ state: 'SERVED' }),
    ]);
    expect(entry.stage).toBe('COMPLETED');
    expect(entry.stage_label).toBe('Đã nhận hàng');
  });
});

describe('buildHistoryEntry — shape khớp whitelist đóng PublicOrderHistoryEntry', () => {
  it('mọi nhánh parse qua .strict() — không field lạ nào (state từng món, unit_price…) lọt ra', () => {
    const entries = [
      buildHistoryEntry(baseRequest(), null, []),
      buildHistoryEntry(
        baseRequest({ status: 'CONFIRMED', order_id: 'ord-1' }),
        { shipped_at: null, received_at: null },
        [item()],
      ),
    ];
    for (const entry of entries) {
      expect(() => PublicOrderHistoryEntry.strict().parse(entry)).not.toThrow();
    }
  });
});
