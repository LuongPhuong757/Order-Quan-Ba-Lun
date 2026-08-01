// Hợp đồng dữ liệu của màn quản lý đơn online — sau khi mở filter 3 trạng thái (OD-11).
//
// Mở filter là mở thêm ĐƯỜNG ĐỌC tới đơn đã xử lý, mà đơn đã xử lý là loại đơn DUY NHẤT có
// `internal_reject_note` (ghi chú nội bộ, D-09 — khách không được thấy, và cả HTTP cũng không).
// Nên 2 thứ phải khoá lại bằng test:
//   1. `internal_reject_note` KHÔNG BAO GIỜ đi qua được schema, dù mapper có lỡ tay thêm vào.
//   2. Filter chỉ nhận đúng 3 trạng thái — không nhận `CANCELLED_BY_CUSTOMER`, không nhận rỗng.
import { describe, expect, it } from 'vitest';
import {
  AdminOnlineOrderRow,
  AdminOnlineOrderStatusFilter,
  type AdminOnlineOrderRow as Row,
} from '@order/schemas';

/** Một hàng đơn đã bị từ chối, đủ field bắt buộc. */
function rejectedRow(): Row {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    order_token_masked: 'AB12…',
    status: 'REJECTED',
    fulfillment_type: 'DELIVERY',
    customer_name: 'Khách thử',
    customer_phone: '0900000001',
    customer_address: '1 Đường Thử',
    customer_map_link: null,
    distance_km: '2.50',
    customer_note: null,
    items: [
      {
        menu_item_id: '22222222-2222-4222-8222-222222222222',
        code: 'M001',
        name: 'Lẩu hải sản',
        unit_price: 185_000,
        qty: 1,
        note: null,
        is_out_of_stock: false,
      },
    ],
    subtotal: 185_000,
    submitted_at_ms: 1_700_000_000_000,
    waiting_seconds: 42,
    out_of_stock_count: 0,
    reviewed_at_ms: 1_700_000_042_000,
    reviewed_by_full_name: 'Nguyễn Văn A',
    reject_reason: 'Hết nguyên liệu món đã đặt',
  };
}

describe('AdminOnlineOrderRow — ghi chú nội bộ không đi ra HTTP (D-09)', () => {
  it('gạt bỏ `internal_reject_note` dù mapper có lỡ tay thêm vào', () => {
    const leaked = { ...rejectedRow(), internal_reject_note: 'gọi 3 lần không bắt máy' };
    const parsed = AdminOnlineOrderRow.parse(leaked);
    expect(parsed).not.toHaveProperty('internal_reject_note');
    expect(JSON.stringify(parsed)).not.toContain('không bắt máy');
  });

  it('gạt bỏ luôn `order_token` đầy đủ và `ip_hash` nếu lọt vào', () => {
    const leaked = {
      ...rejectedRow(),
      order_token: 'ab12cd34ef56'.repeat(4),
      ip_hash: 'deadbeef'.repeat(8),
      user_agent: 'Mozilla/5.0',
    };
    const parsed = AdminOnlineOrderRow.parse(leaked);
    expect(parsed).not.toHaveProperty('order_token');
    expect(parsed).not.toHaveProperty('ip_hash');
    expect(parsed).not.toHaveProperty('user_agent');
    // `order_token_masked` vẫn phải còn — admin cần 4 ký tự đầu để đối chiếu với khách.
    expect(parsed.order_token_masked).toBe('AB12…');
  });

  it('giữ `reject_reason` — đây là câu ĐÃ gửi khách, khác hoàn toàn ghi chú nội bộ', () => {
    const parsed = AdminOnlineOrderRow.parse(rejectedRow());
    expect(parsed.reject_reason).toBe('Hết nguyên liệu món đã đặt');
  });
});

describe('AdminOnlineOrderRow — 3 field của đơn đã xử lý', () => {
  it('đơn WAITING để cả 3 field là null', () => {
    const waiting: Row = {
      ...rejectedRow(),
      status: 'WAITING',
      reviewed_at_ms: null,
      reviewed_by_full_name: null,
      reject_reason: null,
    };
    const parsed = AdminOnlineOrderRow.parse(waiting);
    expect(parsed.reviewed_at_ms).toBeNull();
    expect(parsed.reviewed_by_full_name).toBeNull();
    expect(parsed.reject_reason).toBeNull();
  });

  it('thiếu hẳn field mới thì KHÔNG parse được — tránh BE quên map mà FE lặng lẽ hiện trống', () => {
    const row = rejectedRow() as Record<string, unknown>;
    delete row.reviewed_at_ms;
    expect(() => AdminOnlineOrderRow.parse(row)).toThrow();
  });

  it('đơn đã xác nhận có người duyệt — mặt hiển thị của kiểm soát bù trừ D-02', () => {
    const confirmed: Row = { ...rejectedRow(), status: 'CONFIRMED', reject_reason: null };
    const parsed = AdminOnlineOrderRow.parse(confirmed);
    expect(parsed.reviewed_by_full_name).toBe('Nguyễn Văn A');
  });
});

describe('AdminOnlineOrderStatusFilter — đúng 3 trạng thái xem được', () => {
  it('nhận WAITING, CONFIRMED, REJECTED', () => {
    for (const s of ['WAITING', 'CONFIRMED', 'REJECTED']) {
      expect(AdminOnlineOrderStatusFilter.safeParse(s).success).toBe(true);
    }
  });

  it('KHÔNG nhận CANCELLED_BY_CUSTOMER — khách tự huỷ thì nhân viên không phải làm gì', () => {
    expect(AdminOnlineOrderStatusFilter.safeParse('CANCELLED_BY_CUSTOMER').success).toBe(false);
  });

  it('KHÔNG nhận chuỗi rỗng, chữ thường, hay giá trị lạ', () => {
    for (const s of ['', 'waiting', 'ALL', 'PENDING', null, undefined]) {
      expect(AdminOnlineOrderStatusFilter.safeParse(s).success).toBe(false);
    }
  });
});
