// Tên mã QR cho cột "TK quán" ở Sổ webhook (2026-10-16).
//
// SePay chỉ gửi số tài khoản CỦA QUÁN (`accountNumber`) — tài khoản bên kia (khách chuyển vào,
// NCC nhận tiền ra) thì KHÔNG có trường nào, kể cả ở API quét bù. Nên cột này chỉ nói được
// "tiền vào/ra ở tài khoản nào của quán", và tên lấy từ chính danh sách mã QR chủ quán đặt để
// người đọc nhận ra ngay ("TPBank HKD") thay vì phải nhớ số.
//
// Tách thuần để test được mà không dựng TypeORM.

export type QrAccountLite = {
  label: string;
  account_no: string | null;
  is_active: boolean;
  sort_order: number;
};

/**
 * `account_no` → tên mã QR.
 *
 * Một số tài khoản có thể nằm ở NHIỀU hàng: "xoá" mã QR chỉ là `is_active = false`, chủ quán tạo
 * lại mã mới cùng số tài khoản là chuyện thường. Ưu tiên hàng ĐANG DÙNG — đó là cái tên chủ quán
 * đang gọi tài khoản này — rồi tới thứ tự chủ quán xếp. Mã đã tắt vẫn được tính: giao dịch cũ
 * về tài khoản đó vẫn cần một cái tên.
 */
export function accountLabelMap(rows: QrAccountLite[]): Map<string, string> {
  const sorted = [...rows]
    .filter((r) => !!r.account_no)
    .sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.sort_order - b.sort_order);
  const out = new Map<string, string>();
  for (const r of sorted) {
    const no = r.account_no!.trim();
    if (!out.has(no)) out.set(no, r.label);
  }
  return out;
}
