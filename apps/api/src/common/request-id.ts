// SEC — `X-Request-Id` do client gửi lên, không được tin mù.
//
// Trước đây middleware lấy header nguyên xi. Cột `audit_log.request_id` là varchar(64) và MySQL 8
// (STRICT_TRANS_TABLES) từ chối chuỗi dài hơn → audit write fail, lỗi bị nuốt trong handler async,
// hành động vẫn chạy mà KHÔNG có dòng audit. Gửi 2 header cùng tên thì Express gộp thành mảng,
// cũng vỡ. Giá trị này còn đi thẳng vào CSV export.
//
// Chỉ nhận chuỗi đơn khớp `^[A-Za-z0-9_-]{1,64}$` (UUID, ULID, trace id thông thường đều lọt).
// Không khớp → trả null để middleware tự sinh UUID.

export const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function sanitizeRequestId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  return REQUEST_ID_PATTERN.test(raw) ? raw : null;
}
