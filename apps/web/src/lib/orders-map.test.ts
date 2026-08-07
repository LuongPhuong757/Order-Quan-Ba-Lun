import { describe, expect, it } from 'vitest';
import { MAP_STAGES, coordsOf, stageOf } from './orders-map.ts';

const counts = (over: Partial<{ total: number; ready: number; served: number; cancelled: number }> = {}) => ({
  total: 2,
  pending: 0,
  kitchen: 0,
  cooking: 0,
  ready: 0,
  served: 0,
  cancelled: 0,
  ...over,
});

const row = (over: Partial<Parameters<typeof stageOf>[0]> = {}) => ({
  status: 'CONFIRMED' as const,
  fulfillment_type: 'DELIVERY' as const,
  item_state_counts: counts(),
  shipped_at_ms: null,
  received_at_ms: null,
  ...over,
});

describe('stageOf — màu chấm phải khớp việc thật đang diễn ra ở quán', () => {
  it('đơn chưa duyệt → WAITING, không cần đếm món', () => {
    expect(stageOf(row({ status: 'WAITING', item_state_counts: null }))).toBe('WAITING');
  });

  it('đã duyệt, bếp chưa xong → KITCHEN', () => {
    expect(stageOf(row({ item_state_counts: counts({ ready: 1 }) }))).toBe('KITCHEN');
  });

  it('mọi món hợp lệ đã xong → READY — đây là nhóm chấm dùng để gom một chuyến ship', () => {
    expect(stageOf(row({ item_state_counts: counts({ ready: 1, served: 1 }) }))).toBe('READY');
  });

  it('món huỷ KHÔNG kéo đơn khỏi READY — mẫu số là total trừ cancelled', () => {
    const v = stageOf(row({ item_state_counts: counts({ total: 3, ready: 2, cancelled: 1 }) }));
    expect(v).toBe('READY');
  });

  it('đã rời quán đi giao → SHIPPED, xét trước cả đếm món', () => {
    expect(stageOf(row({ shipped_at_ms: 1, item_state_counts: counts() }))).toBe('SHIPPED');
  });

  it('khách đã nhận → DONE dù còn mốc shipped', () => {
    expect(stageOf(row({ shipped_at_ms: 1, received_at_ms: 2 }))).toBe('DONE');
  });

  it('đơn bị từ chối / khách tự huỷ → DONE, không phải WAITING (không còn việc phải giao)', () => {
    expect(stageOf(row({ status: 'REJECTED', item_state_counts: null }))).toBe('DONE');
    expect(stageOf(row({ status: 'CANCELLED_BY_CUSTOMER', item_state_counts: null }))).toBe('DONE');
  });

  it('mọi chặng stageOf trả về đều có trong chú giải — không có chấm nào vô danh trên bản đồ', () => {
    const legendKeys = MAP_STAGES.map((s) => s.key);
    for (const stage of ['WAITING', 'KITCHEN', 'READY', 'SHIPPED', 'DONE'] as const) {
      expect(legendKeys).toContain(stage);
    }
  });
});

describe('coordsOf — đơn nào lên được bản đồ', () => {
  const src = (over: Partial<Parameters<typeof coordsOf>[0]> = {}) => ({
    fulfillment_type: 'DELIVERY' as const,
    customer_lat: '10.7626220',
    customer_lng: '106.6601720',
    ...over,
  });

  it('toạ độ chuỗi hợp lệ → số', () => {
    expect(coordsOf(src())).toEqual([10.762622, 106.660172]);
  });

  it('đơn khách tự lấy KHÔNG lên bản đồ dù có toạ độ — không ai đi giao nó', () => {
    expect(coordsOf(src({ fulfillment_type: 'PICKUP' }))).toBeNull();
  });

  it('thiếu một trong hai toạ độ → null', () => {
    expect(coordsOf(src({ customer_lat: null }))).toBeNull();
    expect(coordsOf(src({ customer_lng: null }))).toBeNull();
  });

  it('chuỗi rác → null, KHÔNG phải NaN (NaN lọt vào Leaflet là bản đồ nhảy ra giữa đại dương)', () => {
    expect(coordsOf(src({ customer_lat: 'abc' }))).toBeNull();
  });

  it('chuỗi RỖNG → null: Number("") là 0, một toạ độ hợp lệ ngoài khơi châu Phi', () => {
    expect(coordsOf(src({ customer_lat: '', customer_lng: '' }))).toBeNull();
    expect(coordsOf(src({ customer_lat: '  ' }))).toBeNull();
  });
});
