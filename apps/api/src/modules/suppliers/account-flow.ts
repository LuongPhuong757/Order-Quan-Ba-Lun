// Tiền VÀO / tiền RA của MỘT tài khoản ngân hàng theo ngày — biểu đồ ở tab Thống kê của màn
// Nhà cung cấp (2026-10-15, chủ quán yêu cầu).
//
// NGUỒN SỐ LIỆU (chủ quán chốt) — KHÔNG dùng sao kê SePay:
//  - VÀO = phần chuyển khoản của các đơn đã thu vào mã QR đó (`orders.paid_to_account_id`),
//    cùng con số màn Lịch sử hiện ở bảng "về tài khoản nào". Đơn ghi nợ rồi trả sau tính vào
//    ngày TRẢ NỢ — ngày tiền thật sự về tài khoản (`MONEY_AT_SQL` ở orders.service).
//  - RA  = các lần trả NCC bằng chuyển khoản đã chọn tài khoản đó (`supplier_payments`).
//
// Vì vậy biểu đồ này KHÔNG phải sao kê: tiền ra trả lương, điện nước… không có ở đây. Đó là chủ
// ý — câu hỏi của nó là "tài khoản này thu từ khách bao nhiêu, chi cho NCC bao nhiêu".
//
// Ngày tính theo LỊCH giờ VN (0h), không theo ca: đơn 1h sáng ngày 16 nằm ở cột ngày 16, khớp
// sao kê ngân hàng và các biểu đồ khác cùng tab.

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Mốc ms → 'YYYY-MM-DD' theo giờ VN. */
export function vnDay(ms: number): string {
  return new Date(ms + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' → mốc ms 0h00 giờ VN của ngày đó. */
export function vnDayStart(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) - VN_OFFSET_MS;
}

/** 'YYYY-MM-DD' → mốc ms cuối ngày (23:59:59.999) giờ VN. */
export function vnDayEnd(day: string): number {
  return vnDayStart(day) + DAY_MS - 1;
}

/** Một đơn đã thu chuyển khoản vào tài khoản đang xem. */
export type InflowOrder = {
  /** Mốc tiền về: `COALESCE(debt_paid_at, closed_at)`, ms. */
  money_at: number;
  transfer_amount: number;
  /** Tổng thu của đơn (món SERVED + ship) — để kẹp phần CK như `paymentSummary`. */
  order_total: number;
};

export type OutflowPayment = { paid_on: string; amount: number };

export type AccountFlowDay = { day: string; in: number; out: number };

/**
 * Gộp theo ngày. Chỉ trả những ngày CÓ tiền — màn hình tự trải trục theo kỳ (cùng `chonBucket`
 * với các biểu đồ khác), nên server không cần điền ngày trống.
 *
 * Phần CK của đơn bị KẸP về tổng thu — cùng luật `paymentSummary`/`moneyPart`: đơn bị bớt món sau
 * khi thu thì tiền về tài khoản không thể lớn hơn tổng đơn, và hai màn phải ra cùng một con số.
 */
export function gopDongTien(vao: InflowOrder[], ra: OutflowPayment[]): AccountFlowDay[] {
  const byDay = new Map<string, AccountFlowDay>();
  const lay = (day: string) => {
    const cu = byDay.get(day);
    if (cu) return cu;
    const moi = { day, in: 0, out: 0 };
    byDay.set(day, moi);
    return moi;
  };
  for (const o of vao) {
    const tien = Math.max(0, Math.min(o.transfer_amount, o.order_total));
    if (tien > 0) lay(vnDay(o.money_at)).in += tien;
  }
  for (const p of ra) {
    if (p.amount > 0) lay(p.paid_on).out += p.amount;
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}
