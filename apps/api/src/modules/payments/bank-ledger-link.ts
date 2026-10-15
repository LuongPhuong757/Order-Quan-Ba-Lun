/**
 * Nối một dòng tiền về với BÀN / ĐƠN cho màn sổ webhook (2026-10-15) — phần tính toán thuần,
 * tách khỏi controller để test được mà không cần MySQL.
 *
 * Bài toán chủ quán nêu: khách chuyển khoản xong nhưng nhân viên KHÔNG bấm thanh toán, bàn cứ mở
 * mãi, không ai biết tiền đã về. Sổ webhook vốn chỉ bày dữ liệu thô của ngân hàng; giờ mỗi dòng
 * tiền vào có thêm MỘT ô nói nó thuộc bàn nào và bàn đó đang ra sao.
 */

/** Trạng thái đơn mà một khoản tiền đã nối vào — đúng thứ tự người đọc cần lo. */
export type LinkedOrderState =
  /** Bàn còn mở: tiền đã về mà chưa ai bấm thanh toán — ca chủ quán muốn bắt nhất. */
  | 'open'
  /** Đã đóng, có thu chuyển khoản — bình thường. */
  | 'paid'
  /** Đã đóng nhưng ghi TIỀN MẶT, trong khi ngân hàng lại báo CK về đúng mã bàn đó. Gần như luôn
   *  là người thu chọn nhầm hình thức — két sẽ thiếu đúng khoản này lúc đếm. */
  | 'cash'
  /** Đã đóng dạng ghi nợ (chưa thu). */
  | 'debt'
  /** Đơn đã huỷ mà vẫn có tiền về. */
  | 'cancelled';

export type OrderStateInput = {
  closed_at: number | null;
  is_paid: boolean;
  transfer_amount: number;
  debt_at: number | null;
};

/** Cùng bộ luật với `PAID_SQL` / `DEBT_SQL` / `CANCELLED_SQL` ở `orders.service.ts`. */
export function orderStateOf(o: OrderStateInput): LinkedOrderState {
  if (o.closed_at === null) return 'open';
  if (o.is_paid) return o.transfer_amount > 0 ? 'paid' : 'cash';
  return o.debt_at !== null ? 'debt' : 'cancelled';
}

/** Vì sao bộ khớp bật `needs_review` — để màn nói được MỘT lý do cụ thể thay vì một cờ chung. */
export type ReviewReason = 'thieu' | 'thua' | 'sai_tk';

export type ReviewInput = {
  needs_review: boolean;
  amount: number;
  received_amount: number;
  expected_account_no: string | null;
};

/** Cùng ngưỡng với `PaymentsApplyService.OVERPAY_TOLERANCE`. */
const OVERPAY_TOLERANCE = 1.05;

/**
 * Lý do lệch, theo đúng thứ tự `PaymentsApplyService.ingest` xét. Sai tài khoản đứng sau thiếu
 * tiền: thiếu tiền là chuyện phải đòi khách ngay, sai tài khoản chỉ là chuyện soát sao kê.
 */
export function reviewReasonOf(i: ReviewInput, txnAccountNo: string | null): ReviewReason | null {
  if (!i.needs_review) return null;
  if (i.received_amount < i.amount) return 'thieu';
  if (i.expected_account_no !== null && txnAccountNo !== null && i.expected_account_no !== txnAccountNo) {
    return 'sai_tk';
  }
  if (i.received_amount > i.amount * OVERPAY_TOLERANCE) return 'thua';
  return null;
}

export type CandidateInput = { id: string; closed_at: number; transfer_amount: number };

/**
 * Xếp các đơn có thể nhận một khoản tiền lạ: ĐÚNG SỐ TIỀN lên đầu, rồi đơn đóng gần giờ tiền về.
 *
 * Chỉ là GỢI Ý để người chọn nhanh — không bao giờ tự gán. Bộ khớp cố ý không đoán theo số tiền
 * (hai bàn cùng trả 250.000đ trong năm phút là chuyện thường), và màn này cũng không được đoán.
 */
export function rankCandidates<T extends CandidateInput>(rows: readonly T[], amount: number, at: number): T[] {
  return [...rows].sort((a, b) => {
    const ea = a.transfer_amount === amount ? 0 : 1;
    const eb = b.transfer_amount === amount ? 0 : 1;
    if (ea !== eb) return ea - eb;
    return Math.abs(a.closed_at - at) - Math.abs(b.closed_at - at);
  });
}
