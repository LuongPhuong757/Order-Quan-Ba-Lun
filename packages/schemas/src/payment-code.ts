// Mã đơn in trong nội dung chuyển khoản — thứ nối MỘT dòng tiền trong sao kê với MỘT đơn cụ thể
// (2026-09-22, khi nối webhook SePay).
//
// VÌ SAO CẦN, KHI ĐÃ CÓ "BAN05 LUONG THUY":
// chuỗi đó cố ý không có giờ (chủ quán chốt 2026-09-14, xem `transfer-note.ts`), nên bàn 5 có ba
// lượt khách trong một tối, cùng một người thu, sẽ ra ba dòng sao kê chữ giống hệt nhau. Phân biệt
// bằng số tiền + giờ giao dịch thì kẹt ngay khi hai lượt tình cờ cùng số tiền — và đó đúng là lúc
// việc đối soát tự động cần trả lời chính xác nhất. Sáu chữ số phá thế hoà đó.
//
// BA RÀNG BUỘC ép mọi quyết định trong file này:
//
//  1. **Trần 25 ký tự** của trường 62.08 (EMVCo) — dài hơn là QR KHÔNG DỰNG ĐƯỢC, không phải bị
//     cắt gọn. Mã ăn 9 ký tự ("DH123456" + một khoảng trắng), phần còn lại mới tới tên người thu.
//
//  2. Ngân hàng chỉ nhận **chữ không dấu, số và khoảng trắng**. Mã toàn chữ số nên miễn nhiễm với
//     mọi trò bỏ dấu — đây là lý do không dùng base32 hay chữ cái cho gọn: `0/O` và `1/I` nhìn
//     giống nhau trên thông báo ngân hàng, mà người đối soát phải đọc được bằng mắt.
//
//  3. Khách **SỬA ĐƯỢC** nội dung trước khi bấm chuyển — app ngân hàng nào cũng cho. Mã là công cụ
//     TRỢ GIÚP đối soát, KHÔNG phải bằng chứng. Mất mã thì rơi về đối soát tay (và ảnh bill vẫn
//     còn đó), chứ không phải mất tiền.

/** Tiền tố nội dung CK. ĐỔI LÀ HỎNG mọi đơn đang chờ thanh toán: QR đã in ra tay khách mang tiền
 *  tố cũ, còn bộ khớp thì tìm tiền tố mới. Muốn đổi thì phải nhận cả hai một thời gian. */
export const PAYMENT_CODE_PREFIX = 'DH';

/** Số chữ số của mã.
 *
 * SÁU, không phải tám: `description` của payOS giới hạn 9 ký tự với tài khoản không liên kết, và
 * tuy hiện đi SePay thì trần đó không áp, giữ 6 để còn đường đổi cổng mà không phải in lại QR.
 * 900.000 khả năng là thừa cho một quán — va mã chỉ cần bắt `ER_DUP_ENTRY` rồi bốc lại. */
export const PAYMENT_CODE_DIGITS = 6;

/** Số ký tự mã chiếm trong nội dung CK (gồm tiền tố). Dùng ở `transfer-note.ts` để tính phần
 *  còn lại cho tên người thu — đừng tự cộng tay số 8 ở chỗ khác. */
export const PAYMENT_CODE_NOTE_LENGTH = PAYMENT_CODE_PREFIX.length + PAYMENT_CODE_DIGITS;

/**
 * Bóc mã đơn từ nội dung một dòng sao kê.
 *
 * Nội dung thật về tay ta đã qua nhiều lớp bóp méo, nên mẫu này cố ý lỏng ở ba chỗ:
 *  - **hoa/thường** (`i`): một số ngân hàng viết hoa toàn bộ, số khác giữ nguyên.
 *  - **khoảng trắng giữa tiền tố và số**: app ngân hàng của khách có thể chèn vào.
 *  - **chữ bao quanh**: ngân hàng hay bọc thêm ("CHUYEN TIEN DH123456 NGUYEN VAN A TT").
 *
 * Nhưng CHẶT ở hai chỗ, và đây là phần quan trọng:
 *  - `(?<![A-Z0-9])` — "ABCDH123456" KHÔNG phải mã của ta, đó là chuỗi rác trùng đuôi.
 *  - `(?!\d)` — "DH1234567" (7 số) KHÔNG được cắt lấy 6 số đầu rồi khớp nhầm sang đơn khác.
 *
 * Trả `null` khi không thấy. Người gọi TUYỆT ĐỐI không được suy đoán tiếp theo số tiền: đoán sai
 * là đánh dấu "đã trả" cho đơn của người khác, và không có đường nào phát hiện ra.
 */
export function extractPaymentCode(content: string): string | null {
  const re = new RegExp(
    `(?<![A-Z0-9])${PAYMENT_CODE_PREFIX}\\s?(\\d{${PAYMENT_CODE_DIGITS}})(?!\\d)`,
    'i',
  );
  return re.exec(content ?? '')?.[1] ?? null;
}

/** Ghép mã thành đoạn in lên QR: `DH123456`. Ném nếu mã sai khuôn — thà chết ở chỗ sinh mã còn
 *  hơn in ra một QR mà không webhook nào khớp lại được. */
export function paymentNote(code: string): string {
  if (!isValidPaymentCode(code)) {
    throw new Error(`Mã thanh toán phải là ${PAYMENT_CODE_DIGITS} chữ số, nhận được "${code}"`);
  }
  return `${PAYMENT_CODE_PREFIX}${code}`;
}

export function isValidPaymentCode(code: string): boolean {
  return new RegExp(`^\\d{${PAYMENT_CODE_DIGITS}}$`).test(code ?? '');
}
