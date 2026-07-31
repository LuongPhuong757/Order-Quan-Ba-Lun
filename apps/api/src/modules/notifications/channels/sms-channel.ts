// Hợp đồng dùng chung cho mọi driver SMS (M2.D-63). ConsoleSmsChannel/EsmsChannel implement
// đúng interface này — đổi SMS_DRIVER (notifications.module.ts) chỉ đổi implementation nào
// được inject vào SMS_CHANNEL, KHÔNG có dòng logic nào ở nơi gọi (outbox-poller.ts) phải sửa.
// Bằng chứng: sms-channel.test.ts chạy 1 bộ contract test giống nhau cho cả 2 driver.
export interface SmsChannel {
  readonly name: string;
  send(msg: { to: string; message: string }): Promise<{ ok: true } | { ok: false; error: string }>;
}

/** DI token — bind ở notifications.module.ts theo process.env.SMS_DRIVER. */
export const SMS_CHANNEL = Symbol('SMS_CHANNEL');

/** 1 tin SMS tiếng Việt có dấu ~70 ký tự/segment — 300 ký tự chấp nhận được, không để 1 tin
 * khổng lồ chiếm nhiều segment (tốn phí + dễ bị nhà mạng chặn). */
export const SMS_MAX_LENGTH = 300;

/** Chỉ chấp nhận số dạng `+84901234567` hoặc `0901234567` sau khi bỏ khoảng trắng — 9-15 số. */
export function isValidSmsRecipient(raw: string): boolean {
  const trimmed = raw.replace(/\s+/g, '');
  return /^\+?\d{9,15}$/.test(trimmed);
}

/**
 * Nội dung SMS leo thang khi đơn còn WAITING quá `escalate_sms_after_s` (D-15).
 *
 * ⚠ KHÔNG nội suy bất kỳ thông tin khách nào (tên/SĐT/địa chỉ khách): SMS đi tới máy nhân
 * viên, có thể lọt lên màn hình khoá — giảm bề mặt rò PII và cũng không cần thiết để hành
 * động (nhân viên mở trang Hàng chờ duyệt để xem chi tiết đơn nào).
 */
export function buildEscalationSms(input: { waitingSeconds: number; pendingCount: number }): string {
  const { waitingSeconds, pendingCount } = input;
  const msg = `Quán Ba Lún: có ${pendingCount} đơn online chờ duyệt quá ${waitingSeconds}s. Mở trang Hàng chờ duyệt để xử lý.`;
  return msg.length > SMS_MAX_LENGTH ? msg.slice(0, SMS_MAX_LENGTH) : msg;
}
