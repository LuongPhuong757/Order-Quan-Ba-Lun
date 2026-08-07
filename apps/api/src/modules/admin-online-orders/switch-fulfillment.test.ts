// Khoá 2 quy tắc của "đổi hình thức nhận hàng" (chốt 2026-08-06).
//
// Vì sao đáng test kỹ đến vậy cho 2 hàm ngắn: đây là chỗ DUY NHẤT chặn việc đổi một đơn đã rời
// quán, và là chỗ duy nhất quyết định số phận của toạ độ khi địa chỉ đổi. Cả hai lỗi đều IM LẶNG
// — đơn vẫn lưu thành công, chỉ có shipper là tới nhầm nhà và nhật ký nói dối về chuyến đi.
import { describe, expect, it } from 'vitest';
import {
  decideSwitchFulfillment,
  resolveSwitchAddress,
  type SwitchState,
} from './switch-fulfillment.js';

const waiting = (ft: string): SwitchState => ({ status: 'WAITING', fulfillment_type: ft, order: null });
const confirmed = (
  ft: string,
  order: Partial<NonNullable<SwitchState['order']>> = {},
): SwitchState => ({
  status: 'CONFIRMED',
  fulfillment_type: ft,
  order: { shipped_at: null, received_at: null, closed_at: null, ...order },
});

describe('decideSwitchFulfillment — đơn nào đổi được', () => {
  it('đơn chờ duyệt: đổi được, KHÔNG phải chuyển bàn (chưa có bàn nào)', () => {
    expect(decideSwitchFulfillment(waiting('DELIVERY'), 'PICKUP')).toEqual({
      kind: 'SWITCH',
      needsTableMove: false,
    });
  });

  it('đơn đã duyệt còn ở quán: đổi được VÀ phải chuyển bàn', () => {
    expect(decideSwitchFulfillment(confirmed('PICKUP'), 'DELIVERY')).toEqual({
      kind: 'SWITCH',
      needsTableMove: true,
    });
  });

  it('bếp đã xong nhưng chưa đi ship vẫn đổi được — mốc chặn là `shipped_at`, không phải trạng thái bếp', () => {
    expect(decideSwitchFulfillment(confirmed('DELIVERY'), 'PICKUP').kind).toBe('SWITCH');
  });

  it('đơn ĐÃ RỜI QUÁN → chặn, và câu báo chỉ đường thoát (huỷ rồi đặt lại)', () => {
    const d = decideSwitchFulfillment(confirmed('DELIVERY', { shipped_at: 1 }), 'PICKUP');
    expect(d.kind).toBe('CONFLICT');
    if (d.kind !== 'CONFLICT') return;
    expect(d.code).toBe('ALREADY_SHIPPED');
    expect(d.message).toMatch(/huỷ đơn rồi đặt lại/i);
  });

  it('khách đã nhận hàng → chặn (mốc này xét TRƯỚC shipped_at)', () => {
    const d = decideSwitchFulfillment(
      confirmed('DELIVERY', { shipped_at: 1, received_at: 2 }),
      'PICKUP',
    );
    expect(d.kind === 'CONFLICT' && d.code).toBe('ALREADY_RECEIVED');
  });

  it('đơn đã kết (thu tiền hoặc bị huỷ) → chặn', () => {
    const d = decideSwitchFulfillment(confirmed('PICKUP', { closed_at: 9 }), 'DELIVERY');
    expect(d.kind === 'CONFLICT' && d.code).toBe('ORDER_ALREADY_CLOSED');
  });

  it('CONFIRMED mà không tra được Order → chặn, KHÔNG âm thầm đổi mỗi dòng staging', () => {
    const d = decideSwitchFulfillment(
      { status: 'CONFIRMED', fulfillment_type: 'PICKUP', order: null },
      'DELIVERY',
    );
    expect(d.kind === 'CONFLICT' && d.code).toBe('ORDER_NOT_CONFIRMED');
  });

  it.each([
    ['CANCELLED_BY_CUSTOMER', 'ORDER_ALREADY_CANCELLED'],
    ['REJECTED', 'ORDER_ALREADY_REJECTED'],
  ])('đơn %s → chặn với mã %s', (status, code) => {
    const d = decideSwitchFulfillment({ status, fulfillment_type: 'PICKUP', order: null }, 'DELIVERY');
    expect(d.kind === 'CONFLICT' && d.code).toBe(code);
  });

  it('status lạ (dữ liệu cũ / sửa tay) rơi vào nhánh TỪ CHỐI, không phải nhánh cho qua', () => {
    const d = decideSwitchFulfillment(
      { status: 'SOMETHING_NEW', fulfillment_type: 'PICKUP', order: null },
      'DELIVERY',
    );
    expect(d.kind === 'CONFLICT' && d.code).toBe('ORDER_NOT_SWITCHABLE');
  });

  it('bấm đúng hình thức đang có → báo "đã là ... rồi", xét TRƯỚC mọi guard trạng thái', () => {
    // 2 máy cùng mở 1 đơn, cả hai cùng bấm: máy thứ hai phải đọc được câu đúng chuyện đã xảy ra.
    const d = decideSwitchFulfillment(confirmed('PICKUP', { shipped_at: 1 }), 'PICKUP');
    expect(d.kind === 'CONFLICT' && d.code).toBe('FULFILLMENT_UNCHANGED');
  });
});

describe('resolveSwitchAddress — địa chỉ + số phận của toạ độ', () => {
  it('đổi sang PICKUP: GIỮ địa chỉ cũ và giữ luôn toạ độ (đổi ngược lại còn dùng)', () => {
    expect(resolveSwitchAddress('PICKUP', '12 Lê Lợi', undefined)).toEqual({
      kind: 'OK',
      customer_address: '12 Lê Lợi',
      clearGeo: false,
    });
  });

  it('đổi sang PICKUP: địa chỉ nhân viên lỡ gõ bị BỎ QUA, không ghi đè', () => {
    expect(resolveSwitchAddress('PICKUP', '12 Lê Lợi', '99 Trần Phú')).toEqual({
      kind: 'OK',
      customer_address: '12 Lê Lợi',
      clearGeo: false,
    });
  });

  it('đổi sang DELIVERY mà đơn chưa có địa chỉ và không ai nhập → 400 ADDRESS_REQUIRED', () => {
    const r = resolveSwitchAddress('DELIVERY', null, '   ');
    expect(r.kind === 'ERROR' && r.code).toBe('ADDRESS_REQUIRED');
  });

  it('đổi sang DELIVERY với địa chỉ MỚI → xoá toạ độ/km cũ (chúng thuộc về địa chỉ cũ)', () => {
    expect(resolveSwitchAddress('DELIVERY', '12 Lê Lợi', ' 99 Trần Phú ')).toEqual({
      kind: 'OK',
      customer_address: '99 Trần Phú',
      clearGeo: true,
    });
  });

  it('gõ lại ĐÚNG địa chỉ đang lưu (kèm khoảng trắng thừa) → KHÔNG xoá toạ độ', () => {
    // Bấm đổi 2 lần, hoặc form tự điền sẵn địa chỉ cũ rồi gửi lại y nguyên: mất `distance_km` ở
    // đây là mất số km quán dùng để tính phí ship, mà không ai đổi gì cả.
    expect(resolveSwitchAddress('DELIVERY', '12 Lê Lợi', '  12 Lê Lợi ')).toEqual({
      kind: 'OK',
      customer_address: '12 Lê Lợi',
      clearGeo: false,
    });
  });

  it('đổi sang DELIVERY, không nhập gì nhưng đơn đã có địa chỉ → giữ nguyên', () => {
    expect(resolveSwitchAddress('DELIVERY', '12 Lê Lợi', undefined)).toEqual({
      kind: 'OK',
      customer_address: '12 Lê Lợi',
      clearGeo: false,
    });
  });
});
