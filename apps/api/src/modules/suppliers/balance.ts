// Tính công nợ nhà cung cấp. THUẦN, không DB — cùng lệ với `purchase-units.ts`, `price-report.ts`.
//
// Cả bước 3 gói trong một đẳng thức:
//
//     còn phải trả = số dư đầu kỳ + Σ phiếu ĐÃ DUYỆT − Σ đã thanh toán
//
// Cộng MỌI phiếu và trừ MỌI lần trả, không lọc theo ngày (chủ quán chốt 2026-09-07).
//
// Bản trước lọc theo `opening_balance_date`: phiếu và lần trả TRƯỚC mốc bị coi là "đã nằm sẵn
// trong số dư đầu kỳ" nên không cộng/trừ lần nữa. Ý đúng, nhưng sai với cách người ta thật sự
// dùng phần mềm: mốc bị ghim cứng = ngày TẠO NCC, còn việc đầu tiên ai cũng làm là nhập bù phiếu
// mấy tuần trước — nên toàn bộ phiếu vừa nhập rơi vào vùng bị bỏ. Thấy thật trên production
// 2026-09-07: 12 phiếu tổng 22.200.500đ, "đã mua" hiện 0đ.
//
// Nghĩa mới, gọn hơn một bậc và không có vùng im lặng nào: **số dư đầu kỳ là nợ cũ NGOÀI hệ
// thống**, phiếu trong hệ thống là phát sinh, cộng cả hai. `opening_balance_date` từ giờ chỉ là
// thông tin "nợ cũ tính đến ngày nào", không còn là điều kiện lọc.
//
// Đánh đổi: lớp chống đếm hai lần theo ngày mất đi. Nếu ai đó gộp mấy phiếu đã nhập vào luôn số
// dư đầu kỳ thì nợ sẽ phồng lên. Bù lại bằng cảnh báo ngay tại ô nhập số dư đầu kỳ (màn hình nói
// rõ NCC này đã có bao nhiêu phiếu trong hệ thống), chứ không bằng một phép lọc mà người dùng
// không nhìn thấy.

export type DatedAmount = { date: string; amount: number };

export type SupplierBalance = {
  opening_balance: number;
  /** Σ MỌI phiếu đã duyệt. */
  purchased: number;
  /** Σ MỌI lần đã trả. */
  paid: number;
  /** Kết quả cuối. Âm = quán đã trả dư (trả trước, hoặc ghi nhầm). */
  balance: number;
  /** Nợ cũ tính đến ngày nào — THÔNG TIN để màn hình nói rõ số dư đầu kỳ là của mốc nào.
   *  KHÔNG phải điều kiện lọc nữa. NULL = chưa khai số dư đầu kỳ. */
  opening_balance_date: string | null;
};

export function computeBalance(input: {
  opening_balance: number;
  opening_balance_date: string | null;
  deliveries: DatedAmount[];
  payments: DatedAmount[];
}): SupplierBalance {
  const sum = (rows: DatedAmount[]) => rows.reduce((s, r) => s + r.amount, 0);
  const purchased = sum(input.deliveries);
  const paid = sum(input.payments);
  return {
    opening_balance: input.opening_balance,
    purchased,
    paid,
    balance: input.opening_balance + purchased - paid,
    opening_balance_date: input.opening_balance_date,
  };
}
