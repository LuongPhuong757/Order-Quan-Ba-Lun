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

/** Ba màn nối tiếp của hộp thoại thu tiền (2026-09-15).
 *  - 'mode' : "Khách trả bằng gì?" — tổng tiền + ba nút. Tiền mặt XÁC NHẬN LUÔN tại đây.
 *  - 'qr'   : chìa mã cho khách quét (chỉ luồng chuyển khoản / cả hai).
 *  - 'bill' : chụp bill + chốt thu tiền.
 */
export type CheckoutStep = 'mode' | 'qr' | 'bill';

/**
 * Vì sao CHƯA đi tiếp được TỪ MÀN ĐANG ĐỨNG — `null` = đi tiếp được (2026-09-15).
 *
 * Khác `checkoutBlockReason` ở chỗ nó chỉ hỏi về bước hiện tại. Từ lúc hộp thoại tách thành ba
 * màn, luật đầy đủ không còn dùng cho nút "Tiếp tục" được nữa: đứng ở màn 1 mà đòi "chọn mã QR"
 * là chỉ sang một màn người ta CHƯA ĐƯỢC THẤY — nút mờ, câu giải thích nói về thứ không có trên
 * màn hình, và không còn đường nào bấm.
 *
 * Màn cuối ('bill') vẫn gọi luật đầy đủ: đó là cú bấm GHI TIỀN, phải kiểm lại trọn bộ chứ không
 * tin rằng hai màn trước đã kiểm đủ — người dùng lùi lại sửa được, và state đi cùng họ.
 */
export function stepBlockReason(step: CheckoutStep, s: CheckoutState): string | null {
  if (step === 'mode') {
    // Tiền mặt chốt luôn ở màn này nên phải kiểm trọn bộ; các hình thức khác chỉ cần "đã chọn".
    if (s.mode === 'CASH') return checkoutBlockReason(s);
    return s.mode === null ? 'Vui lòng chọn khách trả bằng gì' : null;
  }
  if (step === 'qr') {
    if (!s.hasPickedQr) return 'Vui lòng chọn mã QR để thanh toán';
    // Hỏi tiền SAU khi đã có mã: số tiền nằm trong chính mã QR, nên thứ tự trên màn hình là chọn
    // mã rồi mới tới con số.
    if (s.mode === 'SPLIT' && s.transferAmount <= 0) return 'Nhập số tiền khách chuyển khoản';
    return null;
  }
  return checkoutBlockReason(s);
}
