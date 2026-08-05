import { z } from 'zod';

// Hợp đồng OTP + phiên SĐT (2026-08-04) — "đăng nhập bằng OTP" cho apps/shop.
//
// Mô hình đã chốt với chủ dự án (2026-08-04):
//  - KHÔNG có màn đăng nhập riêng. Verify OTP thành công (ở checkout hoặc tra cứu) = một
//    phiên đăng nhập gắn SĐT, hạn 90 ngày TRƯỢT (mỗi lần dùng tự gia hạn).
//  - Mỗi thiết bị tối đa MỘT tài khoản SĐT: đổi sang số khác = OTP số mới + huỷ phiên số
//    cũ ở cả server lẫn thiết bị (`current_session_token` bên dưới là đường huỷ đó).
//  - Toàn bộ luồng nằm sau công tắc `otp_login_enabled` (settings, mặc định TẮT) — kênh
//    gửi thật (ZNS/SMS) chưa đăng ký, bật cứng lên là chặn 100% khách đặt đơn.
//
// SĐT đi trong body POST như mọi hợp đồng public khác (không lên URL — lọt access log).

export const PublicOtpRequest = z.object({
  phone: z.string().min(9).max(20),
});
export type PublicOtpRequest = z.infer<typeof PublicOtpRequest>;

/** Response của `POST /api/public/otp/request`. KHÔNG bao giờ chứa mã OTP — mã chỉ đi qua
 * kênh gửi (SMS/ZNS/log mock). `cooldown_s` để FE đếm ngược nút "Gửi lại". */
export const PublicOtpRequestResult = z.object({
  /** Giây phải chờ trước khi được xin mã tiếp theo cho cùng SĐT. */
  cooldown_s: z.number().int().nonnegative(),
  /** Mã vừa gửi sống bao lâu (giây) — FE hiện "mã có hiệu lực trong N phút". */
  expires_in_s: z.number().int().positive(),
});
export type PublicOtpRequestResult = z.infer<typeof PublicOtpRequestResult>;

export const PublicOtpVerify = z.object({
  phone: z.string().min(9).max(20),
  /** 6 chữ số — giữ dạng string để không mất số 0 đầu. */
  code: z.string().regex(/^\d{6}$/, 'Mã OTP gồm 6 chữ số'),
  /** Phiên đang có trên thiết bị (nếu có) — verify thành công thì BE THU HỒI phiên này
   * (ngữ nghĩa "đăng nhập sang tài khoản khác": mỗi thiết bị một tài khoản). */
  current_session_token: z.string().min(32).optional(),
});
export type PublicOtpVerify = z.infer<typeof PublicOtpVerify>;

/** Phiên SĐT trả về sau verify thành công — FE lưu localStorage, gắn vào submit/lookup. */
export const PublicPhoneSession = z.object({
  session_token: z.string(),
  /** SĐT đã chuẩn hoá (`normalizePhone`) — FE so sánh số nhập ở checkout với bản này. */
  phone: z.string(),
  expires_at_ms: z.number().int(),
});
export type PublicPhoneSession = z.infer<typeof PublicPhoneSession>;
