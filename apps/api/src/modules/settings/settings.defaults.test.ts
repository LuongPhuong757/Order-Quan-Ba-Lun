// Khoá những giá trị mặc định mà QUÁN CHƯA TỪNG CẤU HÌNH vẫn phải sống chung.
//
// Vì sao nhóm này đáng có test riêng: `SETTINGS_DEFAULTS` không phải "giá trị gợi ý". Key nào chưa
// có dòng trong bảng `store_settings` thì fallback ở đây LÀ hành vi thật của hệ thống — và với một
// quán mới deploy thì đó là gần như mọi key. Đổi một con số ở file kia là đổi hành vi production
// ngay lập tức, không cần ai bấm gì; test này để việc đó không xảy ra trong im lặng.
import { describe, expect, it } from 'vitest';
import { SETTINGS_DEFAULTS_MAP } from './settings.defaults.js';

describe('Mặc định có HẬU QUẢ TRỰC TIẾP với khách — đổi là phải sửa test này', () => {
  /**
   * 30 km (chủ dự án chốt 2026-08-09, ghi đè lựa chọn `0` của bản 2026-08-07).
   *
   * Đây là mặc định DUY NHẤT trong file có thể TỪ CHỐI đơn của khách thật mà không ai bật gì:
   * quán chưa có dòng `max_delivery_km` trong DB thì con số này áp dụng ngay từ đơn đầu tiên.
   * Nếu ai đó hạ nó xuống (vd 5) thì quán mất đơn hàng loạt và triệu chứng duy nhất là "dạo này
   * ít đơn xa" — không log, không cảnh báo. Test đỏ ở đây là lời nhắc đọc lại docblock bên
   * `settings.defaults.ts` trước khi đổi.
   */
  it('max_delivery_km = 30', () => {
    expect(SETTINGS_DEFAULTS_MAP.max_delivery_km).toBe(30);
  });

  /** Bảng bậc phí ship RỖNG = chưa cấu hình → không đâu hiện phí tạm tính. Đoán hộ một bảng giá
   *  "hợp lý" là để khách đọc được con số quán chưa bao giờ đồng ý. */
  it('ship_fee_tiers rỗng — hệ thống không tự bịa bảng giá', () => {
    expect(SETTINGS_DEFAULTS_MAP.ship_fee_tiers).toEqual([]);
  });

  /** Toạ độ quán `null` = chưa cấu hình → không tính được km, và điều đó KHÔNG được chặn khách
   *  đặt hàng (xem `delivery-radius.ts`: "không biết khách ở đâu" ≠ "khách ở quá xa"). */
  it('store_lat/store_lng = null — thiếu toạ độ không được chặn đơn', () => {
    expect(SETTINGS_DEFAULTS_MAP.store_lat).toBeNull();
    expect(SETTINGS_DEFAULTS_MAP.store_lng).toBeNull();
  });

  /** OTP mặc định TẮT: kênh gửi thật (ZNS/SMS) chưa đăng ký, bật lên khi chưa có sender thật =
   *  khách không nhận được mã = không ai đặt được đơn. */
  it('otp_login_enabled = false', () => {
    expect(SETTINGS_DEFAULTS_MAP.otp_login_enabled).toBe(false);
  });

  /** `[]` = KHÔNG giới hạn giờ, tức luôn mở — không phải "đóng cửa cả tuần". */
  it('open_hours rỗng nghĩa là không giới hạn giờ', () => {
    expect(SETTINGS_DEFAULTS_MAP.open_hours).toEqual([]);
  });
});