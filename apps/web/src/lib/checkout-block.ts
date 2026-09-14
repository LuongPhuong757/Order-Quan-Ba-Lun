// Luật "đã bấm Thanh toán được chưa, và nếu chưa thì vì sao" (2026-09-14).
//
// Tách khỏi `CheckoutDialog.tsx` vì đây là luật nghiệp vụ chứ không phải chi tiết dựng giao diện:
// nó quyết định một nút thu tiền có ăn hay không, mà kiểm nó bằng mắt thì phải mở hộp thoại thật
// và thử đủ sáu tổ hợp. Ở đây là hàm thuần, test chạy trong vài mili giây.
//
// MỘT chỗ duy nhất quyết định cả hai việc: nút có mờ không, và câu nói ra khi người ta cố bấm.
// Tách làm hai nơi thì sẽ có ngày nút mờ mà câu giải thích nói chuyện khác.

export type PayMode = 'CASH' | 'TRANSFER' | 'SPLIT';

export type CheckoutState = {
  /** `null` = chưa chọn hình thức nào. */
  mode: PayMode | null;
  /** Đã chọn mã QR chưa. Chỉ có nghĩa khi thu chuyển khoản. */
  hasPickedQr: boolean;
  /** Phần tiền chuyển khoản đang nhập. */
  transferAmount: number;
};

/**
 * Trả về câu giải thích vì sao CHƯA bấm được, hoặc `null` nếu bấm được.
 *
 * Thứ tự các nhánh là thứ tự người dùng gặp trên màn hình — chọn hình thức, rồi chọn mã, rồi
 * nhập tiền. Nói về bước xa nhất trong khi bước gần vẫn còn trống là chỉ sai đường.
 */
export function checkoutBlockReason(s: CheckoutState): string | null {
  const wantsTransfer = s.mode === 'TRANSFER' || s.mode === 'SPLIT';
  if (s.mode === null) return 'Vui lòng chọn khách trả bằng gì';
  // Mã QR là BẮT BUỘC khi thu chuyển khoản (chủ quán chốt 2026-09-14). Không có mã thì đơn không
  // ghi được tiền về tài khoản nào, và cuối ngày khoản đó nằm trong nhóm "không gắn mã" ở màn
  // đối soát — đúng thứ cả tính năng này sinh ra để tránh.
  if (wantsTransfer && !s.hasPickedQr) return 'Vui lòng chọn mã QR để thanh toán';
  // Chỉ hỏi số tiền ở thế "Cả hai": "Chuyển khoản" toàn bộ thì số tiền chính là tổng, không có gì
  // để nhập.
  if (s.mode === 'SPLIT' && s.transferAmount <= 0) return 'Nhập số tiền khách chuyển khoản';
  return null;
}
