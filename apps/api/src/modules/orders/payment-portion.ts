// Tách TIỀN của một đơn theo hình thức thu (2026-10-12) — phần dùng chung của `stats` và
// `paymentSummary` ở màn Lịch sử.
//
// VÌ SAO CẦN: bộ lọc ở màn đó chọn ĐƠN, nhưng con số người ta cần là TIỀN. Với đơn trả "Cả hai"
// hai thứ đó vỡ ra: lọc tài khoản A mà cộng trọn đơn là cộng cả phần tiền mặt vào số "tiền về A"
// — đúng con số mang đi dò sao kê, sai là dò mãi không khớp. Lọc "Tiền mặt" thì phần tiền mặt của
// đơn Cả hai cũng phải có mặt, không thì két thừa tiền so với màn hình.
//
// Hàm THUẦN, không đụng DB — phần dễ sai nhất (chọn phần nào, chia sao cho cộng lại đúng tổng)
// kiểm được bằng unit test.

/** Phần tiền mà bộ lọc đang hỏi tới. 'all' = trọn đơn (không lọc gì về tiền, hoặc lọc "Cả hai"). */
export type MoneyPortion = 'all' | 'cash' | 'transfer';

/**
 * Bộ lọc đang chọn hỏi về PHẦN TIỀN nào.
 *
 * Thứ tự ưu tiên là quyết định của chủ quán (2026-10-12):
 *  1. "Tiền mặt" thắng tất cả — kể cả khi chọn cùng tài khoản A: danh sách là đơn Cả hai có CK về
 *     A, còn con số là phần tiền mặt của chúng. Mỗi bộ lọc giữ đúng nghĩa của nó.
 *  2. "Chuyển khoản", tài khoản nhận, ngân hàng xác nhận, ảnh bill → phần CK. Ba bộ lọc sau đều
 *     nói về KHOẢN chuyển khoản, nên cộng phần tiền mặt vào là trả lời sai câu hỏi.
 *  3. Còn lại (kể cả "Cả hai") → trọn đơn.
 */
export function moneyPortion(f: {
  payment?: 'cash' | 'transfer' | 'mixed';
  qr_account_id?: string;
  verified?: 'yes' | 'no';
  photo?: 'has' | 'missing';
}): MoneyPortion {
  if (f.payment === 'cash') return 'cash';
  if (f.payment === 'transfer' || f.qr_account_id || f.verified || f.photo) return 'transfer';
  return 'all';
}

/**
 * Lấy phần `portion` của một khoản tiền `amount` thuộc một đơn.
 *
 * `amount` có thể là trọn tổng thu (`orderTotal`) hoặc chỉ một mảnh của nó — tiền món (ô Doanh
 * thu KHÔNG cộng ship), hay phí ship. Mảnh nào cũng chia THEO TỈ LỆ chuyển khoản / tổng thu
 * (chủ quán chốt): khách chuyển 30% đơn thì 30% tiền món và 30% ship là chuyển khoản. Cách này
 * luôn cộng lại đúng: phần CK + phần tiền mặt = `amount`.
 *
 * Phần CK làm tròn, phần tiền mặt là PHẦN CÒN LẠI — không làm tròn cả hai, nếu không hai số có
 * ngày lệch tổng 1đ và người đối soát mất lòng tin vào cả bảng.
 *
 * `transferAmount` vượt tổng (đơn bị sửa bớt món sau khi thu) thì kẹp về tổng — cùng lệ với
 * `paymentSummary`: tiền mặt về 0 chứ không thành số âm.
 */
export function moneyPart(
  portion: MoneyPortion,
  amount: number,
  orderTotal: number,
  transferAmount: number,
): number {
  if (portion === 'all') return amount;
  const tr = Math.min(Math.max(transferAmount, 0), orderTotal);
  const transferPart = orderTotal > 0 ? Math.round((amount * tr) / orderTotal) : 0;
  return portion === 'transfer' ? transferPart : amount - transferPart;
}
