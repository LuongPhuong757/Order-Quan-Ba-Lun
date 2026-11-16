// Câu tóm tắt TÌNH TRẠNG cho màn Cài đặt (2026-11-16, chủ quán duyệt bản xem thử).
//
// Danh sách nhóm trước chỉ có câu mô tả cố định ("Giờ mở cửa, hình thức nhận hàng…") — phải mở
// từng nhóm mới biết quán đang mở hay cầu in đã chết. Nay dòng dưới tên nhóm nói TÌNH TRẠNG thật,
// và hàng ở trang "Đặt hàng online" ghi sẵn giá trị đang dùng. Hàm thuần để test được.

type Span = { from: string; to: string };

/** "10:00–22:00", "10:00–14:00 · 17:00–24:00", "24/24". Ngoại lệ theo thứ chỉ đếm số ngày —
 *  ghi hết ra thì hàng không còn đọc được trên điện thoại. */
export function hoursSummary(
  input: { default: Span[]; exceptions: Array<{ spans: Span[] }> },
  configured: boolean,
): string {
  if (!configured) return '24/24';
  const base = input.default.length === 0 ? 'Nghỉ' : input.default.map((s) => `${s.from}–${s.to}`).join(' · ');
  const n = input.exceptions.length;
  return n > 0 ? `${base} (+${n} ngày riêng)` : base;
}

export function shipSummary(s: {
  pickup_enabled: boolean;
  delivery_enabled: boolean;
  max_delivery_km: number;
}): string {
  const giao = s.max_delivery_km > 0 ? `Giao ≤${s.max_delivery_km} km` : 'Giao';
  if (s.pickup_enabled && s.delivery_enabled) return `Lấy · ${giao}`;
  if (s.pickup_enabled) return 'Chỉ khách lấy';
  if (s.delivery_enabled) return `Chỉ ${giao.toLowerCase()}`;
  return 'Đang tắt cả hai';
}

export type OrderingState = { enabled: boolean; blocking_reason: 'MANUAL_OFF' | 'OUTSIDE_HOURS' | null };

/** ⚠ Câu phải nói đúng hành vi BE (xem comment dải trạng thái ở OnlineHome): "Đóng cửa" không
 *  có nghĩa khách hết đặt được. */
export function orderingLabel(st: OrderingState): string {
  if (st.enabled) return 'Đang nhận đơn';
  return st.blocking_reason === 'OUTSIDE_HOURS' ? 'Ngoài giờ mở cửa' : 'Đang đóng cửa';
}

/** Tablet/POS im lặng quá lâu = cầu in đã chết. Cùng mốc với `PrintersPanel`. */
export const PRINT_DEVICE_STALE_MS = 90_000;

export type Hint = { text: string; warn: boolean };

export function printerHint(
  printingEnabled: boolean,
  devices: Array<{ revoked_at: number | null; last_seen_at: number | null }>,
  now: number,
): Hint {
  if (!printingEnabled) return { text: 'Đang tắt in hoá đơn', warn: false };
  const active = devices.filter((d) => !d.revoked_at);
  if (active.length === 0) return { text: 'Chưa có cầu in', warn: true };
  const live = active.some((d) => d.last_seen_at !== null && now - d.last_seen_at < PRINT_DEVICE_STALE_MS);
  return live ? { text: 'Cầu in đang chạy', warn: false } : { text: 'Cầu in không chạy', warn: true };
}

export function paymentHint(activeQr: number, verifyOn: boolean): Hint {
  if (activeQr === 0) return { text: 'Chưa có mã QR nhận tiền', warn: true };
  return { text: `${activeQr} mã QR · xác thực ngân hàng ${verifyOn ? 'bật' : 'tắt'}`, warn: false };
}
