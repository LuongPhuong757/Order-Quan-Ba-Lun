// Tuổi món = khách đã chờ bao lâu. Dùng CHUNG cho màn Bếp (KDS) và màn Order
// (drawer bàn) — bồi bàn và bếp phải đọc cùng một ngưỡng, nếu lệch thì bồi bàn
// thấy "đỏ" mà bếp thấy "bình thường" là hai bên tranh nhau vô ích.
//
// Luôn tính từ `created_at` (lúc khách gọi món), KHÔNG dùng `updated_at`:
// updated_at reset mỗi lần đổi state (KITCHEN → COOKING → READY) nên đồng hồ sẽ
// nhảy về 0 và che mất món đã chờ lâu.

export const AGE_WARN_MS = 10 * 60_000; // 10ph → vàng đậm (cảnh báo)
export const AGE_CRITICAL_MS = 20 * 60_000; // 20ph → đỏ đậm (khẩn cấp)

/** Màu chữ theo tuổi món. */
export function ageColor(created_at: number): string {
  const age = Date.now() - created_at;
  if (age > AGE_CRITICAL_MS) return '#b91c1c'; // đỏ-700 đậm — quá 20ph (gấp)
  if (age > AGE_WARN_MS) return '#ca8a04'; // vàng-600 đậm — quá 10ph (cảnh báo)
  return '#111827'; // đen — món mới (< 10ph)
}

/** Số phút đã chờ (làm tròn xuống, không âm nếu lệch giờ client/server). */
export function ageMinutes(created_at: number): number {
  return Math.max(0, Math.floor((Date.now() - created_at) / 60_000));
}

/**
 * Tuổi món thành chữ ngắn: `45p`, `1h`, `1h1p`, `2h5p`.
 *
 * Quá một tiếng thì "61p" đọc chậm — mắt phải chia nhẩm mới biết là đã hơn một tiếng, mà đó
 * đúng là lúc cần phản ứng nhanh nhất. "1h1p" nói ngay điều đó.
 *
 * Tròn giờ thì BỎ phần phút (`1h` chứ không `1h0p`): con số này nằm ở góc thẻ bàn với cỡ chữ
 * 11px, mỗi ký tự thừa là một ký tự phải liếc. "0p" không thêm thông tin nào.
 *
 * Để ở đây chứ không viết lẻ ở từng màn: ba màn (lưới bàn, drawer bàn, Bếp) cùng nói về một
 * con số, trước đây mỗi màn một kiểu — `61′`, `61 phút`, `61p`. Nhân viên đi qua đi lại giữa
 * ba màn thì ba cách viết là ba lần phải dịch lại trong đầu.
 */
export function formatAge(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 60) return `${m}p`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h${rem}p`;
}

/** Đã quá ngưỡng khẩn cấp → bồi bàn nên ưu tiên hoặc báo khách. */
export function isAgeCritical(created_at: number): boolean {
  return Date.now() - created_at > AGE_CRITICAL_MS;
}
