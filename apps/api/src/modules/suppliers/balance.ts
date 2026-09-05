// Tính công nợ nhà cung cấp. THUẦN, không DB — cùng lệ với `purchase-units.ts`, `price-report.ts`.
//
// Cả bước 3 gói trong một đẳng thức:
//
//     còn phải trả = số dư đầu kỳ + Σ phiếu ĐÃ DUYỆT − Σ đã thanh toán
//
// Nhưng có một cái bẫy làm hỏng toàn bộ con số nếu bỏ qua: phiếu nhập và lần trả tiền xảy ra
// TRƯỚC mốc số dư đầu kỳ thì đã nằm sẵn trong `opening_balance` rồi. Cộng chúng thêm lần nữa là
// tính hai lần. Đó là lý do `sumAfter` tồn tại và được test riêng.

export type DatedAmount = { date: string; amount: number };

export type SupplierBalance = {
  opening_balance: number;
  /** Σ phiếu đã duyệt TỪ mốc số dư đầu kỳ trở đi. */
  purchased: number;
  /** Σ đã trả TỪ mốc số dư đầu kỳ trở đi. */
  paid: number;
  /** Kết quả cuối. Âm = quán đã trả dư (trả trước, hoặc ghi nhầm). */
  balance: number;
  /** Mốc đang tính từ đó, để màn hình nói rõ "số này tính từ ngày nào". NULL = từ đầu. */
  counted_from: string | null;
};

/** Cộng những dòng KỂ TỪ `cutoff` trở đi (bao gồm chính ngày đó).
 *
 * `cutoff` NULL = cộng tất cả: chưa khai số dư đầu kỳ thì mặc định coi như bắt đầu từ con số 0
 * ở đầu thời gian, và toàn bộ lịch sử là phát sinh.
 *
 * So chuỗi 'YYYY-MM-DD' trực tiếp, không đổi sang `Date`: định dạng này so từ điển ra đúng thứ
 * tự thời gian, và tránh hẳn chuyện lệch múi giờ khi máy chủ chạy UTC còn quán ở +07.
 */
export function sumAfter(rows: DatedAmount[], cutoff: string | null): number {
  return rows
    .filter((r) => cutoff === null || r.date >= cutoff)
    .reduce((sum, r) => sum + r.amount, 0);
}

export function computeBalance(input: {
  opening_balance: number;
  opening_balance_date: string | null;
  deliveries: DatedAmount[];
  payments: DatedAmount[];
}): SupplierBalance {
  const cutoff = input.opening_balance_date;
  const purchased = sumAfter(input.deliveries, cutoff);
  const paid = sumAfter(input.payments, cutoff);
  return {
    opening_balance: input.opening_balance,
    purchased,
    paid,
    balance: input.opening_balance + purchased - paid,
    counted_from: cutoff,
  };
}
