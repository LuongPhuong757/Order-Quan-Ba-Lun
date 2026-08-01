import { describe, expect, it } from 'vitest';
import type { PublicOrderStatus } from '@order/schemas';
import { detectOrderUpdate } from './order-update.ts';

// M2.D-47 — khách đang mở trang, quán sửa đơn → phải hiện banner "Quán đã cập nhật đơn của bạn".
//
// Cái bẫy của tính năng này: `updated_at_ms` đổi MỖI LẦN bếp chuyển trạng thái món
// (PENDING→KITCHEN→COOKING→READY→SERVED). Nếu lấy nó làm điều kiện thì banner nhảy liên tục suốt
// bữa ăn, và khách sẽ học được cách phớt lờ banner — đúng lúc quán huỷ món thật thì không ai đọc.
// Nên điều kiện là DANH SÁCH MÓN / TỔNG TIỀN / SỐ MÓN HUỶ đổi, không phải mốc thời gian.

function base(): PublicOrderStatus {
  return {
    order_token: 'abc123',
    status: 'WAITING',
    fulfillment_type: 'DELIVERY',
    items: [
      { name: 'Lẩu hải sản', qty: 1, unit_price: 185_000 },
      { name: 'Rau nhúng', qty: 2, unit_price: 25_000 },
    ],
    subtotal: 235_000,
    submitted_at_ms: 1_700_000_000_000,
    store_phone: '0900000000',
    reject_reason: null,
    stage: 'RECEIVED',
    stage_label: 'Quán đã nhận đơn',
    percent: 0,
    cancelled_count: 0,
    cancelled_note: null,
    eta_min: null,
    eta_max: null,
    updated_at_ms: 1_700_000_000_000,
  };
}

describe('detectOrderUpdate — lần poll đầu', () => {
  it('prev = null thì KHÔNG coi là quán vừa sửa', () => {
    expect(detectOrderUpdate(null, base())).toBe(false);
  });
});

describe('detectOrderUpdate — những thay đổi KHÔNG phải "quán sửa đơn"', () => {
  it('không có gì đổi', () => {
    expect(detectOrderUpdate(base(), base())).toBe(false);
  });

  it('CHỈ `updated_at_ms` tăng — bếp chuyển trạng thái món, không phải sửa đơn', () => {
    const next = { ...base(), updated_at_ms: base().updated_at_ms + 60_000 };
    expect(detectOrderUpdate(base(), next)).toBe(false);
  });

  it('status WAITING → CONFIRMED nhưng món y hệt — stepper đã diễn đạt việc này', () => {
    const next: PublicOrderStatus = {
      ...base(),
      status: 'CONFIRMED',
      stage: 'CONFIRMED',
      stage_label: 'Quán đã xác nhận',
      percent: 15,
      updated_at_ms: base().updated_at_ms + 30_000,
    };
    expect(detectOrderUpdate(base(), next)).toBe(false);
  });

  it('percent tăng — tiến độ chạy, không phải sửa đơn', () => {
    const next = { ...base(), percent: 45, stage_label: 'Đang nấu' as const };
    expect(detectOrderUpdate(base(), next)).toBe(false);
  });
});

describe('detectOrderUpdate — những thay đổi LÀ "quán sửa đơn"', () => {
  it('bớt 1 món', () => {
    const next = { ...base(), items: [base().items[0]!], subtotal: 185_000 };
    expect(detectOrderUpdate(base(), next)).toBe(true);
  });

  it('thêm 1 món', () => {
    const next = {
      ...base(),
      items: [...base().items, { name: 'Bia', qty: 1, unit_price: 20_000 }],
      subtotal: 255_000,
    };
    expect(detectOrderUpdate(base(), next)).toBe(true);
  });

  it('đổi qty của 1 món', () => {
    const items = base().items.map((i, idx) => (idx === 1 ? { ...i, qty: 4 } : i));
    expect(detectOrderUpdate(base(), { ...base(), items, subtotal: 285_000 })).toBe(true);
  });

  it('đổi subtotal dù danh sách món trông y hệt', () => {
    // Xảy ra khi quán sửa giá món tại bàn — món không đổi tên/số lượng nhưng tiền đổi.
    expect(detectOrderUpdate(base(), { ...base(), subtotal: 300_000 })).toBe(true);
  });

  it('đổi unit_price của 1 món', () => {
    const items = base().items.map((i, idx) => (idx === 0 ? { ...i, unit_price: 199_000 } : i));
    expect(detectOrderUpdate(base(), { ...base(), items })).toBe(true);
  });

  it('cancelled_count tăng — ngoại lệ bắt buộc của G-1 (M2.D-21), che là lừa khách', () => {
    const next = {
      ...base(),
      cancelled_count: 1,
      cancelled_note: '1 món đã huỷ — quán sẽ liên hệ bạn',
    };
    expect(detectOrderUpdate(base(), next)).toBe(true);
  });

  it('đổi TÊN món (quán đổi món khác cùng giá) — vẫn là sửa đơn', () => {
    const items = base().items.map((i, idx) => (idx === 0 ? { ...i, name: 'Lẩu bò' } : i));
    expect(detectOrderUpdate(base(), { ...base(), items })).toBe(true);
  });
});

describe('detectOrderUpdate — không phụ thuộc thứ tự món trong mảng', () => {
  it('cùng bộ món nhưng BE trả thứ tự khác thì KHÔNG báo sửa đơn', () => {
    // Không có ORDER BY ổn định thì MySQL được phép trả thứ tự khác giữa 2 lần đọc. Nếu hàm này
    // nhạy với thứ tự, banner sẽ nhảy oan mà không ai tìm ra nguyên nhân.
    const next = { ...base(), items: [...base().items].reverse() };
    expect(detectOrderUpdate(base(), next)).toBe(false);
  });
});
