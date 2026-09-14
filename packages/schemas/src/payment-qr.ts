// Mã QR nhận tiền — dữ liệu + luật dùng chung cho cả BE (kiểm khi lưu) và FE (ô nhập).
//
// Ở trong `@order/schemas` chứ không nằm riêng bên API vì màn cài đặt cần đúng danh sách ngân
// hàng này để dựng ô chọn, và hai bản copy của một bảng mã BIN là hai bản lệch nhau dần.

/** Ngân hàng + mã BIN 6 số theo chuẩn Napas/VietQR.
 *
 * ⚠ BIN SAI = QR quét ra sai ngân hàng, khách bấm chuyển rồi mới biết không tới. Vì vậy danh
 * sách này CỐ Ý NGẮN — chỉ những ngân hàng phổ biến ở quán ăn. Ngân hàng không có trong đây thì
 * chủ quán gõ tay BIN (giao diện có ô "Ngân hàng khác"), và phải tự quét thử một lần trước khi
 * dùng thật. Thà bắt gõ tay còn hơn đưa sẵn một con số đoán mò.
 */
export const VIETQR_BANKS: ReadonlyArray<{ bin: string; short_name: string; full_name: string }> = [
  { bin: '970436', short_name: 'Vietcombank', full_name: 'NH TMCP Ngoại thương Việt Nam' },
  { bin: '970415', short_name: 'VietinBank', full_name: 'NH TMCP Công thương Việt Nam' },
  { bin: '970418', short_name: 'BIDV', full_name: 'NH TMCP Đầu tư và Phát triển Việt Nam' },
  { bin: '970405', short_name: 'Agribank', full_name: 'NH NN&PTNT Việt Nam' },
  { bin: '970422', short_name: 'MB Bank', full_name: 'NH TMCP Quân đội' },
  { bin: '970407', short_name: 'Techcombank', full_name: 'NH TMCP Kỹ thương Việt Nam' },
  { bin: '970416', short_name: 'ACB', full_name: 'NH TMCP Á Châu' },
  { bin: '970432', short_name: 'VPBank', full_name: 'NH TMCP Việt Nam Thịnh vượng' },
  { bin: '970423', short_name: 'TPBank', full_name: 'NH TMCP Tiên Phong' },
  { bin: '970403', short_name: 'Sacombank', full_name: 'NH TMCP Sài Gòn Thương Tín' },
  { bin: '970437', short_name: 'HDBank', full_name: 'NH TMCP Phát triển TP.HCM' },
  { bin: '970441', short_name: 'VIB', full_name: 'NH TMCP Quốc tế Việt Nam' },
  { bin: '970443', short_name: 'SHB', full_name: 'NH TMCP Sài Gòn – Hà Nội' },
  { bin: '970426', short_name: 'MSB', full_name: 'NH TMCP Hàng hải Việt Nam' },
  { bin: '970448', short_name: 'OCB', full_name: 'NH TMCP Phương Đông' },
  { bin: '970440', short_name: 'SeABank', full_name: 'NH TMCP Đông Nam Á' },
  { bin: '970431', short_name: 'Eximbank', full_name: 'NH TMCP Xuất nhập khẩu Việt Nam' },
  { bin: '970449', short_name: 'LPBank', full_name: 'NH TMCP Lộc Phát Việt Nam' },
  { bin: '970419', short_name: 'NCB', full_name: 'NH TMCP Quốc dân' },
  { bin: '970412', short_name: 'PVcomBank', full_name: 'NH TMCP Đại Chúng Việt Nam' },
];

/** BIN là đúng 6 chữ số — mọi mã Napas đều vậy. Ô "Ngân hàng khác" dùng luật này để chặn cú gõ
 *  thiếu/thừa số ngay tại chỗ thay vì để nó thành một QR chết. */
export const VIETQR_BIN_RE = /^\d{6}$/;

/** Số tài khoản: chữ và số, tối đa 19 ký tự (trần của chuẩn EMVCo cho trường này). Có ngân hàng
 *  dùng số tài khoản lẫn chữ, nên KHÔNG được ép chỉ chữ số. */
export const BANK_ACCOUNT_NO_RE = /^[A-Za-z0-9]{4,19}$/;

export type PaymentQrKind = 'BANK' | 'IMAGE';

/** Hình dạng tối thiểu để kiểm luật — cố ý không nhận nguyên entity để hàm này test được mà
 *  không cần dựng TypeORM. */
export type PaymentQrDraft = {
  kind: PaymentQrKind;
  label?: string | null;
  bank_bin?: string | null;
  account_no?: string | null;
  account_name?: string | null;
  image_url?: string | null;
};

/**
 * Trả về câu lỗi tiếng Việt đầu tiên, hoặc `null` nếu hợp lệ.
 *
 * Tách thành hàm THUẦN (không Nest, không TypeORM) vì đây là luật nghiệp vụ chứ không phải chi
 * tiết của một controller — cùng lý do `checkout-total.ts` được tách ra: công thức phải có bằng
 * chứng riêng bằng test, không phải chờ dựng cả MySQL mới kiểm được.
 *
 * Luật gốc: mỗi loại mã có đúng những ô BẮT BUỘC của nó. Một hàng `BANK` thiếu số tài khoản là
 * một mã không bao giờ vẽ được QR — để lọt xuống DB thì nó chỉ lộ ra đúng lúc khách đang đứng
 * đợi trả tiền.
 */
export function validatePaymentQrDraft(draft: PaymentQrDraft): string | null {
  if (!draft.label || !draft.label.trim()) {
    return 'Phải đặt tên cho mã QR để người thu tiền biết đang chọn cái nào';
  }
  if (draft.kind === 'BANK') {
    if (!draft.bank_bin || !VIETQR_BIN_RE.test(draft.bank_bin)) {
      return 'Mã ngân hàng (BIN) phải là 6 chữ số';
    }
    if (!draft.account_no || !BANK_ACCOUNT_NO_RE.test(draft.account_no)) {
      return 'Số tài khoản không hợp lệ (4–19 ký tự, chỉ chữ và số)';
    }
    if (!draft.account_name || !draft.account_name.trim()) {
      return 'Phải có tên chủ tài khoản để khách biết mình chuyển cho ai';
    }
    return null;
  }
  if (draft.kind === 'IMAGE') {
    if (!draft.image_url || !draft.image_url.trim()) {
      return 'Mã QR dạng ảnh thì phải tải lên tấm ảnh QR';
    }
    return null;
  }
  return 'Loại mã QR không hợp lệ';
}

/** Tên ngân hàng để hiển thị, tra từ BIN. `null` khi BIN do chủ quán gõ tay và không nằm trong
 *  danh sách — nơi gọi tự quyết định lấy tên người dùng nhập. */
export function bankNameFromBin(bin: string | null | undefined): string | null {
  if (!bin) return null;
  return VIETQR_BANKS.find((b) => b.bin === bin)?.short_name ?? null;
}
