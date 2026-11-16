import { describe, expect, it } from 'vitest';
import { hoursSummary, orderingLabel, paymentHint, printerHint, shipSummary } from './settings-summary.ts';

describe('hoursSummary', () => {
  it('chưa cấu hình giờ = mở 24/24', () => {
    expect(hoursSummary({ default: [{ from: '10:00', to: '22:00' }], exceptions: [] }, false)).toBe('24/24');
  });
  it('nối nhiều khoảng, đếm ngày ngoại lệ', () => {
    expect(
      hoursSummary(
        { default: [{ from: '10:00', to: '14:00' }, { from: '17:00', to: '24:00' }], exceptions: [{ spans: [] }] },
        true,
      ),
    ).toBe('10:00–14:00 · 17:00–24:00 (+1 ngày riêng)');
  });
});

describe('shipSummary', () => {
  it('ghi bán kính khi có giới hạn', () => {
    expect(shipSummary({ pickup_enabled: true, delivery_enabled: true, max_delivery_km: 30 })).toBe('Lấy · Giao ≤30 km');
    expect(shipSummary({ pickup_enabled: true, delivery_enabled: true, max_delivery_km: 0 })).toBe('Lấy · Giao');
  });
  it('chỉ một hình thức hoặc tắt cả hai', () => {
    expect(shipSummary({ pickup_enabled: true, delivery_enabled: false, max_delivery_km: 5 })).toBe('Chỉ khách lấy');
    expect(shipSummary({ pickup_enabled: false, delivery_enabled: true, max_delivery_km: 5 })).toBe('Chỉ giao ≤5 km');
    expect(shipSummary({ pickup_enabled: false, delivery_enabled: false, max_delivery_km: 0 })).toBe('Đang tắt cả hai');
  });
});

describe('orderingLabel', () => {
  it('phân biệt đóng tay với ngoài giờ', () => {
    expect(orderingLabel({ enabled: true, blocking_reason: null })).toBe('Đang nhận đơn');
    expect(orderingLabel({ enabled: false, blocking_reason: 'OUTSIDE_HOURS' })).toBe('Ngoài giờ mở cửa');
    expect(orderingLabel({ enabled: false, blocking_reason: 'MANUAL_OFF' })).toBe('Đang đóng cửa');
  });
});

describe('printerHint', () => {
  const now = 1_000_000_000;
  it('tắt in thì không báo động', () => {
    expect(printerHint(false, [], now)).toEqual({ text: 'Đang tắt in hoá đơn', warn: false });
  });
  it('bỏ qua thiết bị đã thu hồi', () => {
    expect(printerHint(true, [{ revoked_at: 1, last_seen_at: now }], now)).toEqual({ text: 'Chưa có cầu in', warn: true });
  });
  it('gọi về quá 90 giây là không chạy', () => {
    expect(printerHint(true, [{ revoked_at: null, last_seen_at: now - 91_000 }], now).warn).toBe(true);
    expect(printerHint(true, [{ revoked_at: null, last_seen_at: now - 5_000 }], now)).toEqual({
      text: 'Cầu in đang chạy',
      warn: false,
    });
  });
});

describe('paymentHint', () => {
  it('chưa có mã nào thì cảnh báo', () => {
    expect(paymentHint(0, true).warn).toBe(true);
    expect(paymentHint(2, true).text).toBe('2 mã QR · xác thực ngân hàng bật');
  });
});
