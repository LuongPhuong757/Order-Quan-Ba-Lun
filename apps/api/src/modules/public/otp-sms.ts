// Nội dung tin SMS chứa mã OTP (2026-08-06). Module THUẦN: không import Nest/TypeORM để test
// được mà không dựng app — cùng khuôn `phone.ts`, `otp.ts`.
//
// ⚠ Đầu số cố định của eSMS (SmsType 8) yêu cầu ĐĂNG KÝ TRƯỚC MẪU nội dung. Gửi nội dung khác
// mẫu đã duyệt = eSMS từ chối, khách không nhận được mã. Vì vậy mẫu phải sửa được bằng env
// (`OTP_SMS_TEMPLATE`) mà không phải build lại image: lúc eSMS duyệt mẫu, chỉ cần dán đúng
// chuỗi họ duyệt vào env rồi restart.
//
// Mẫu mặc định viết KHÔNG DẤU có chủ đích: tin không dấu được 160 ký tự/segment, có dấu chỉ
// còn 70 → có dấu là tự nhân đôi tiền mỗi lần gửi mã.

/** Chỗ thay mã trong mẫu. Mẫu thiếu placeholder này = tin gửi đi không có mã → coi như mẫu hỏng. */
export const OTP_CODE_PLACEHOLDER = '{code}';

export const DEFAULT_OTP_SMS_TEMPLATE =
  'Ma xac minh cua ban la {code}, het han sau 5 phut. Quan Ba Lun khong bao gio hoi ma nay.';

/**
 * Ghép nội dung tin OTP từ mẫu.
 *
 * `rawTemplate` thiếu `{code}` (hoặc rỗng) → rơi về mẫu mặc định thay vì gửi tin cụt: gửi tin
 * không có mã vừa tốn tiền vừa làm khách bấm gửi lại vô ích. Caller (`SmsOtpSender`) chịu
 * trách nhiệm cảnh báo ra log khi rơi về mặc định.
 */
export function buildOtpSms(code: string, rawTemplate?: string): string {
  const template = isUsableTemplate(rawTemplate) ? rawTemplate : DEFAULT_OTP_SMS_TEMPLATE;
  return template.split(OTP_CODE_PLACEHOLDER).join(code);
}

/** Mẫu dùng được = có chuỗi và có chỗ thay mã. */
export function isUsableTemplate(rawTemplate?: string): rawTemplate is string {
  return typeof rawTemplate === 'string' && rawTemplate.includes(OTP_CODE_PLACEHOLDER);
}

/**
 * Che SĐT để ghi log sự cố gửi tin: `0901234567` → `090****567`.
 *
 * Log lỗi phải đủ để chủ quán đối chiếu với bảng kê eSMS, nhưng file log không phải chỗ chứa
 * SĐT đầy đủ của khách (cùng lý do M2.D-56 hash IP ở luồng public).
 */
export function maskPhone(phone: string): string {
  if (phone.length < 7) return '***';
  return `${phone.slice(0, 3)}${'*'.repeat(phone.length - 6)}${phone.slice(-3)}`;
}
