/**
 * M7.D-02 — khách tự GÕ số bàn mình đang ngồi vào một ô nhập số.
 *
 * Chuỗi khách gõ là dữ liệu bẩn nhất của cả milestone: gõ vội, gõ kèm chữ "bàn", gõ số 0
 * đứng đầu theo đúng con số dán trên mặt bàn ("05"), gõ luôn mã bàn trong hệ thống ("B05").
 * Hàm này chuẩn hoá tất cả về CHỮ SỐ rồi so bằng giá trị số, nên "5" = "05" = "B05" = "bàn 5".
 *
 * ── Vì sao thà trả NONE còn hơn đoán ──
 * M7.R1 xếp "khách gõ nhầm số bàn" là rủi ro CAO và KHÔNG có cách phát hiện tự động: món sẽ
 * vào đúng một bàn có thật, chỉ là bàn của người khác. Chốt chặn duy nhất là khách nhìn TÊN
 * BÀN cỡ lớn rồi xác nhận. Nên khi hai bàn cùng ra một số, hàm trả AMBIGUOUS để tầng trên
 * bắt khách nhờ nhân viên — tuyệt đối KHÔNG tự chọn bàn đầu tiên trong danh sách.
 */

export type TableLike = {
  id: string;
  code: string;
  name: string;
  kind: string;
  is_active: boolean;
};

/** Generic để GIỮ NGUYÊN kiểu thật của entity truyền vào — caller cần đọc tiếp các cột khác
 *  (`kiotviet_locked`…) mà `TableLike` cố ý không khai, vì hàm này chỉ cần 5 cột để so khớp. */
export type TableMatch<T extends TableLike = TableLike> =
  | { kind: 'ONE'; table: T }
  | { kind: 'NONE' }
  | { kind: 'AMBIGUOUS'; tables: T[] };

/** Trần độ dài chuỗi nhận từ khách. Dài hơn số bàn dài nhất rất nhiều — thứ gì vượt mốc này
 *  không phải người gõ số bàn, nên không phân tích tiếp. */
const MAX_INPUT_LEN = 16;

export function digitsOf(s: string): string {
  return s.replace(/\D/g, '');
}

export function matchTableByInput<T extends TableLike>(
  input: string,
  tables: readonly T[],
): TableMatch<T> {
  if (input.length > MAX_INPUT_LEN) return { kind: 'NONE' };

  const digits = digitsOf(input);
  if (digits === '') return { kind: 'NONE' };

  // So bằng GIÁ TRỊ SỐ, không so chuỗi: "05" và "5" phải là một, mà `restaurant_tables.code`
  // trong DB là 'B01'..'B12' nên cũng phải rút chữ số ra trước khi so.
  const want = Number(digits);
  if (!Number.isSafeInteger(want)) return { kind: 'NONE' };

  const hits = tables.filter((t) => {
    // M7.D-01 — QR là lối vào của khách ĐANG NGỒI TRONG QUÁN. Bàn mang về / giao hàng không
    // phải chỗ ngồi, bàn đã tắt thì không còn phục vụ. Lọc ở đây để chúng không bao giờ lọt
    // vào kết quả, kể cả khi làm một bàn hợp lệ trùng số bị coi là AMBIGUOUS oan.
    if (!t.is_active || t.kind !== 'dine-in') return false;
    const d = digitsOf(t.code);
    return d !== '' && Number(d) === want;
  });

  if (hits.length === 0) return { kind: 'NONE' };
  if (hits.length === 1) return { kind: 'ONE', table: hits[0]! };
  return { kind: 'AMBIGUOUS', tables: hits };
}
