// normalizePhone — chuẩn hoá SĐT Việt Nam về 1 dạng DUY NHẤT: '0' + 9-10 chữ số.
//
// Đây là KHOÁ SO KHỚP DUY NHẤT cho blacklist (M2.D-59), cho kiểm "1 đơn mở/SĐT" (order-guard.ts)
// và cho đếm rate limit theo SĐT (M2.D-40) — nếu 2 nơi chuẩn hoá khác nhau thì cả 3 cơ chế
// chống lạm dụng đều rò (ví dụ: '+84912345678' và '0912345678' bị coi là 2 số khác nhau).
//
// Module thuần: không import Nest hay TypeORM, để test được mà không dựng app/DB.

/**
 * Chuẩn hoá SĐT: loại mọi ký tự không phải chữ số (khoảng trắng, gạch nối, ngoặc), đổi tiền tố
 * `+84`/`84` thành `0`. Trả `null` nếu kết quả không khớp `/^0\d{8,10}$/` (gọi bên ngoài quyết
 * định mã lỗi). Kết quả luôn ≤ 16 ký tự (khớp `varchar(16)` của `phone_blacklist` và
 * `online_order_requests.customer_phone`).
 */
export function normalizePhone(raw: string): string | null {
  const hasPlusPrefix = raw.trim().startsWith('+');
  const digitsOnly = raw.replace(/\D/g, '');

  let normalized: string;
  if (hasPlusPrefix && digitsOnly.startsWith('84')) {
    normalized = `0${digitsOnly.slice(2)}`;
  } else if (!hasPlusPrefix && digitsOnly.startsWith('84') && digitsOnly.length >= 11) {
    normalized = `0${digitsOnly.slice(2)}`;
  } else {
    normalized = digitsOnly;
  }

  if (!/^0\d{8,10}$/.test(normalized)) return null;
  return normalized;
}
