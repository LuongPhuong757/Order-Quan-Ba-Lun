/**
 * M7.D-04 — mã bàn 4 chữ số. M7.D-17 — sinh ở lần BÁO BẾP ĐẦU TIÊN của bàn, bất kể món do
 * khách quét QR gọi hay nhân viên gọi hộ.
 *
 * ── Vì sao 4 chữ số là đủ, và vì sao phải loại mã yếu ──
 * 4 chữ số chỉ có 10.000 tổ hợp — nghe ít, nhưng M7.R2 đã phân tích: mã chỉ cần duy nhất
 * trong TẬP ĐƠN ĐANG MỞ (vài chục bàn), và dò trúng cũng chỉ xem được bill + gửi một lượt
 * vào hàng chờ DUYỆT, không trừ tiền ai và không xuống bếp. Cái phải chặn là kẻ dò "trúng số"
 * ngay vài lần thử đầu — nên mọi mã mà người ta gõ đầu tiên khi đoán bừa đều bị loại.
 *
 * `rng` bơm từ ngoài vào để test xác định được; production truyền `randomInt` của `node:crypto`
 * (CSPRNG). KHÔNG dùng `Math.random` — mã bàn là thứ chặn người lạ đọc bill của bàn khác.
 */

/** Số lần thử tối đa trước khi chịu thua. M7 (D-15 cũ): cạn mã thì BÁO LỖI RÕ, tuyệt đối
 *  không tự nới độ dài mã — cạn thật là dấu hiệu bị lạm dụng, phải lộ ra chứ không âm thầm
 *  đổi format mã đang in trên màn hình của những bàn khác. */
export const GUEST_CODE_MAX_TRIES = 50;

const GUEST_CODE_SPACE = 10_000;

/** Mã mà người đoán bừa sẽ gõ đầu tiên. */
export function isWeakGuestCode(code: string): boolean {
  if (/^(\d)\1{3}$/.test(code)) return true; // 0000, 1111, … 9999
  return code === '1234' || code === '4321';
}

/**
 * @param taken mã của các đơn ĐANG MỞ. Không phải mọi mã từng cấp — mã được tái dùng sau khi
 *              bàn thanh toán, nếu không thì 10.000 tổ hợp cạn sau khoảng 200 ngày.
 * @returns mã 4 chữ số, hoặc `null` khi không tìm được chỗ trống sau `maxTries` lần.
 */
export function pickGuestCode(
  taken: ReadonlySet<string>,
  rng: () => number,
  maxTries: number = GUEST_CODE_MAX_TRIES,
): string | null {
  for (let i = 0; i < maxTries; i++) {
    const code = String(rng() % GUEST_CODE_SPACE).padStart(4, '0');
    if (isWeakGuestCode(code)) continue;
    if (taken.has(code)) continue;
    return code;
  }
  return null;
}
