// Mã đơn in trong nội dung chuyển khoản — thứ nối MỘT dòng tiền trong sao kê với MỘT lần thu
// (2026-09-22, khi nối webhook SePay).
//
// HÌNH DẠNG: `BAN01ABC` — ba chữ cái ngẫu nhiên gắn sau mã bàn.
//
//   BAN01   ABC
//   └─┬─┘   └┬┘
//     │      └── 3 chữ cái ngẫu nhiên, sinh bằng CSPRNG ở server
//     └───────── bàn 01 (đơn online là `DON00`)
//
// VÌ SAO GẮN MÃ BÀN VÀO CHÍNH MÃ (chủ quán chốt 2026-09-22):
//
//  1. **Thu hẹp phạm vi trùng xuống từng bàn từng ngày.** Một bàn mỗi ngày chỉ 2–3 đơn, nên trùng
//     ba chữ cái trong phạm vi đó là gần như không thể. Nếu mã không mang bàn thì phạm vi là CẢ
//     QUÁN — với ~60 đơn/ngày, ba ký tự ngẫu nhiên trùng nhau tới ~83% (nghịch lý ngày sinh).
//     Ràng buộc thật vẫn nằm ở DB: `UNIQUE(code, code_day)`, xem `payment-intent.entity.ts`.
//
//  2. **Đọc sao kê bằng mắt thấy ngay bàn nào**, không phải mở app tra. Bản trước tách mã bàn ra
//     một từ riêng ("DH123 BAN05 ...") thì tốn thêm một dấu cách và đẩy tên người thu vào vùng bị
//     cắt của trần 25 ký tự.
//
// BA RÀNG BUỘC ép mọi quyết định dưới đây:
//
//  1. **Trần 25 ký tự** của trường 62.08 (EMVCo) — dài hơn là QR KHÔNG DỰNG ĐƯỢC. `SEVQR BAN01ABC
//     LUONG THUY` vừa đúng 25.
//  2. Ngân hàng chỉ nhận **chữ không dấu, số và khoảng trắng**.
//  3. Khách **SỬA ĐƯỢC** nội dung trước khi bấm chuyển. Mã là công cụ TRỢ GIÚP đối soát, KHÔNG
//     phải bằng chứng — mất mã thì rơi về đối soát tay, không phải mất tiền.

/** Nhóm của lần thu, cũng là thứ khiến chuỗi này nhận ra được giữa một rừng số của ngân hàng.
 *  `BAN` = thu tại bàn · `DON` = đơn online. */
export const PAYMENT_CODE_GROUPS = ['BAN', 'DON'] as const;

/** Số chữ cái ngẫu nhiên. Ba là đủ vì phạm vi duy nhất chỉ là MỘT BÀN trong MỘT NGÀY. */
export const PAYMENT_CODE_LETTERS = 3;

/** Bảng chữ cái sinh mã — CỐ Ý BỎ `I` và `O`.
 *
 *  Người đối soát đọc mã này bằng mắt trên thông báo ngân hàng, mà `I` lẫn với `1` và `O` lẫn với
 *  `0` ngay bên cạnh hai chữ số của mã bàn. Mất 2 chữ cái đổi lấy việc không bao giờ phải đoán —
 *  vẫn còn 24³ = 13.824 khả năng cho mỗi bàn mỗi ngày. */
export const PAYMENT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/** `^(BAN|DON)\d{2}[A-Z]{3}$` */
const CODE_RE = new RegExp(`^(?:${PAYMENT_CODE_GROUPS.join('|')})\\d{2}[A-Z]{${PAYMENT_CODE_LETTERS}}$`);

export function isValidPaymentCode(code: string): boolean {
  return CODE_RE.test(code ?? '');
}

/**
 * Ghép mã từ nhóm + số bàn + chữ cái. `('BAN', 5, 'ABC')` → `BAN05ABC`.
 *
 * Bàn không có số (bàn "Mang về", "Giao hàng") và đơn online đều dùng `00`: hai chữ số luôn có mặt
 * để chuỗi giữ đúng một hình dạng — mẫu dò ở `extractPaymentCode` dựa vào điều đó.
 */
export function buildPaymentCode(
  group: (typeof PAYMENT_CODE_GROUPS)[number],
  tableNo: number | null | undefined,
  letters: string,
): string {
  const no = String(Math.max(0, Math.min(99, Number(tableNo) || 0))).padStart(2, '0');
  const code = `${group}${no}${letters.toUpperCase()}`;
  if (!isValidPaymentCode(code)) {
    throw new Error(`Mã thanh toán sai khuôn: "${code}"`);
  }
  return code;
}

/**
 * Bóc mã từ nội dung một dòng sao kê.
 *
 * Nội dung thật về tay ta đã qua tay khách (sửa được), qua app ngân hàng của khách (chèn chữ), rồi
 * qua ngân hàng nhận (bọc kín) — chuỗi thật đã gặp:
 *
 *   `CT DEN:106T2691148BUT55 MBVCB.16177901321.548513.SEVQR BAN02ABC.CT tu 0901000137182 ...`
 *
 * Nên mẫu LỎNG ở chỗ bao quanh (dấu chấm, không có khoảng trắng cũng nhận) nhưng CHẶT ở hai ranh
 * giới, và đây mới là phần quan trọng:
 *
 *  · `(?<![A-Z0-9])` — "VIETINBANK01ABC" không phải mã của ta. Không có nó thì mọi chữ "BANK",
 *    "NGAN HANG" trong nội dung ngân hàng đều thành ứng viên.
 *  · `(?![A-Z0-9])`  — "BAN01ABCD" không được cắt lấy 8 ký tự đầu rồi khớp nhầm sang bàn khác.
 *
 * Trả `null` khi không thấy. Người gọi TUYỆT ĐỐI không được suy đoán tiếp theo số tiền: đoán sai
 * là đánh dấu "đã trả" cho đơn của người khác, và không có đường nào phát hiện ra.
 */
export function extractPaymentCode(content: string): string | null {
  const re = new RegExp(
    `(?<![A-Z0-9])((?:${PAYMENT_CODE_GROUPS.join('|')})\\d{2}[A-Z]{${PAYMENT_CODE_LETTERS}})(?![A-Z0-9])`,
    'i',
  );
  const hit = re.exec(content ?? '')?.[1];
  return hit ? hit.toUpperCase() : null;
}

/** Trần độ dài tiền tố bắt buộc của ngân hàng. Mỗi ký tự ở đây ăn vào 25 ký tự của trường 62.08,
 *  nên tiền tố dài là trực tiếp cắt mất tên người thu. `SEVQR` (dài nhất đang biết) là 5. */
export const NOTE_PREFIX_MAX = 8;

/**
 * Tiền tố mà ngân hàng BẮT BUỘC phải có ở ĐẦU nội dung, tra theo mã BIN.
 *
 * Đây không phải quy ước của quán mà là điều kiện để cổng trung gian NHÌN THẤY giao dịch. Với
 * VietinBank cá nhân nối qua API, tài liệu SePay ghi: "bắt buộc mọi giao dịch có nội dung thanh
 * toán phải bắt đầu bằng từ khóa SEVQR". Thiếu nó thì tiền về tài khoản thật nhưng SePay không
 * nhận được biến động — app không bao giờ biết, và không có lỗi nào hiện ra ở đâu cả.
 *
 * Đã gặp thật 2026-09-22: chuyển 3.000đ vào VietinBank với nội dung không có SEVQR, webhook im
 * lặng tuyệt đối.
 *
 * Trả `null` = ngân hàng không đòi tiền tố nào. Chủ quán vẫn GÕ ĐÈ được ở màn Cài đặt — bảng tra
 * này chỉ là gợi ý mặc định, vì danh sách ngân hàng và luật của cổng đều đổi theo thời gian.
 *
 * ⚠ `null` ở đây nghĩa là "CHƯA BIẾT ngân hàng này đòi gì", KHÔNG phải "đã xác nhận là không
 * đòi". Cách duy nhất để biết chắc là chuyển thật 10.000đ rồi xem `bank_transactions` có dòng
 * không — quy trình ở `docs/DOI-SOAT-SEPAY.md`, mục "Thêm một tài khoản mới". Nếu im lặng thì
 * thêm đúng một dòng vào bảng dưới đây.
 */
// `Map` chứ KHÔNG phải object literal: BIN là chuỗi do chủ quán GÕ TAY được ở ô "Ngân hàng khác",
// nên nó tới đây với giá trị bất kỳ. Tra bằng `obj[bin]` thì `bin = 'constructor'` trả về hàm
// dựng của Object — một giá trị truthy mà TypeScript vẫn tin là `string`, và nó sẽ đi thẳng vào
// nội dung chuyển khoản. `Map` chỉ trả về thứ đã được đặt vào.
const NOTE_PREFIX_BY_BIN = new Map<string, string>([
  // VietinBank cá nhân — đã kiểm bằng tiền thật 2026-09-22, thiếu SEVQR là webhook im tuyệt đối.
  ['970415', 'SEVQR'],
  // TPBank (970423), Vietcombank (970436), MB Bank (970422): ba tài khoản mở thêm 2026-09-23.
  // Cả ba đi API chính thức của SePay và tài liệu KHÔNG nhắc tới từ khoá bắt buộc nào, nên để
  // trống — nhưng phải chạy bài thử 10.000đ cho TỪNG tài khoản trước khi tin.
  // Thấy im lặng thì thêm đúng một dòng `['970423', 'SEVQR'],` vào đây, không sửa chỗ nào khác.
]);

export function suggestedNotePrefix(bankBin: string | null | undefined): string | null {
  if (!bankBin) return null;
  return NOTE_PREFIX_BY_BIN.get(bankBin) ?? null;
}

/**
 * Đoạn in lên QR: `BAN01ABC`, hoặc `SEVQR BAN01ABC` khi ngân hàng đòi tiền tố.
 *
 * Tiền tố đứng TRƯỚC mã vì ngân hàng đòi nó ở ĐẦU nội dung — không phải đâu đó trong chuỗi.
 */
export function paymentNote(code: string, prefix?: string | null): string {
  if (!isValidPaymentCode(code)) {
    throw new Error(`Mã thanh toán sai khuôn, nhận được "${code}"`);
  }
  const head = (prefix ?? '').trim().toUpperCase();
  return head ? `${head} ${code}` : code;
}
