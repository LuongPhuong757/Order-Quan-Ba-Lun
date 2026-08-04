import { describe, expect, it } from 'vitest';
import { fulfillmentView } from './fulfillment.ts';

// item_state_counts mẫu: 5 món, 3 xong (2 READY + 1 SERVED), 1 đang nấu, 1 huỷ.
const counts = (over: Partial<NonNullable<Parameters<typeof fulfillmentView>[0]['item_state_counts']>> = {}) => ({
  total: 5,
  pending: 0,
  kitchen: 0,
  cooking: 1,
  ready: 2,
  served: 1,
  cancelled: 1,
  ...over,
});

describe('fulfillmentView', () => {
  it('DELIVERY chưa xong bếp → "Đang chuẩn bị", nút kế tiếp là Đã đi ship (không chặn ship sớm)', () => {
    const v = fulfillmentView({
      fulfillment_type: 'DELIVERY',
      item_state_counts: counts(),
      shipped_at_ms: null,
      received_at_ms: null,
    });
    expect(v.label).toBe('Đang chuẩn bị');
    expect(v.step).toBe('KITCHEN');
    expect(v.action).toBe('ship');
    expect(v.actionLabel).toBe('Đã đi ship');
    // Mẫu số trừ món huỷ (M2.D-21): 5 total − 1 cancelled = 4, xong 3.
    expect(v.doneCount).toBe(3);
    expect(v.validCount).toBe(4);
    expect(v.cancelledCount).toBe(1);
    expect(v.done).toBe(false);
  });

  it('DELIVERY bếp xong hết → "Đã xong, chờ giao"', () => {
    const v = fulfillmentView({
      fulfillment_type: 'DELIVERY',
      item_state_counts: counts({ cooking: 0, ready: 3 }),
      shipped_at_ms: null,
      received_at_ms: null,
    });
    expect(v.label).toBe('Đã xong, chờ giao');
    expect(v.step).toBe('READY');
    expect(v.action).toBe('ship');
  });

  it('PICKUP bếp xong hết → "Sẵn sàng lấy hàng", KHÔNG có nút (tới lấy + trả tiền = checkout)', () => {
    const v = fulfillmentView({
      fulfillment_type: 'PICKUP',
      item_state_counts: counts({ cooking: 0, ready: 3 }),
      shipped_at_ms: null,
      received_at_ms: null,
    });
    expect(v.label).toBe('Sẵn sàng lấy hàng');
    expect(v.step).toBe('READY');
    expect(v.action).toBeNull();
    expect(v.actionLabel).toBeNull();
  });

  it('DELIVERY đã ship → "Đang giao", KHÔNG còn nút nào (khách nhận = thanh toán)', () => {
    const v = fulfillmentView({
      fulfillment_type: 'DELIVERY',
      item_state_counts: counts(),
      shipped_at_ms: 1_000,
      received_at_ms: null,
    });
    expect(v.label).toBe('Đang giao');
    expect(v.step).toBe('SHIPPED');
    expect(v.action).toBeNull();
    expect(v.actionLabel).toBeNull();
  });

  it('mốc received xét TRƯỚC đếm món: món huỷ muộn không kéo lùi trạng thái', () => {
    const v = fulfillmentView({
      fulfillment_type: 'DELIVERY',
      // Tình huống: khách đã nhận rồi 1 món bị huỷ muộn — counts nói "chưa xong".
      item_state_counts: counts(),
      shipped_at_ms: 1_000,
      received_at_ms: 2_000,
    });
    expect(v.label).toBe('Đã nhận hàng');
    expect(v.step).toBe('RECEIVED');
    expect(v.done).toBe(true);
    expect(v.action).toBeNull();
  });

  it('PICKUP đã nhận → "Đã lấy hàng" (không nói "đã giao" với khách tự lấy)', () => {
    const v = fulfillmentView({
      fulfillment_type: 'PICKUP',
      item_state_counts: counts(),
      shipped_at_ms: null,
      received_at_ms: 2_000,
    });
    expect(v.label).toBe('Đã lấy hàng');
    expect(v.done).toBe(true);
  });

  it('chưa có Order thật (counts null) → không đếm món, vẫn ra chặng bếp', () => {
    const v = fulfillmentView({
      fulfillment_type: 'DELIVERY',
      item_state_counts: null,
      shipped_at_ms: null,
      received_at_ms: null,
    });
    expect(v.doneCount).toBeNull();
    expect(v.validCount).toBeNull();
    expect(v.label).toBe('Đang chuẩn bị');
  });

  it('huỷ hết món (valid = 0) → KHÔNG coi là bếp xong', () => {
    const v = fulfillmentView({
      fulfillment_type: 'DELIVERY',
      item_state_counts: counts({ cooking: 0, ready: 0, served: 0, cancelled: 5 }),
      shipped_at_ms: null,
      received_at_ms: null,
    });
    expect(v.label).toBe('Đang chuẩn bị');
    expect(v.validCount).toBe(0);
  });
});
