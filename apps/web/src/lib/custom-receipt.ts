// Hoá đơn tự do (M6) — phần tính toán của màn In hoá đơn, tách khỏi component để test được mà
// không cần dựng React.

/** Một dòng đang soạn trên màn hình. `key` chỉ để React phân biệt các dòng; nó không đi lên server. */
export type DraftLine = {
  key: string;
  name: string;
  qty: number;
  unit_price: number;
  note: string;
};

let seq = 0;

export function blankLine(): DraftLine {
  seq += 1;
  return { key: `l${seq}`, name: '', qty: 1, unit_price: 0, note: '' };
}

/** Cùng phép cộng với `computeCheckoutTotals` ở BE: tiền món và phí giao hàng là HAI con số, vì
 *  phí ship không phải doanh thu món. Ở đây không có món huỷ để lọc — xoá dòng là xong. */
export function receiptTotals(lines: DraftLine[], shipFee: number) {
  const items_total = lines.reduce((sum, l) => sum + (l.unit_price || 0) * (l.qty || 0), 0);
  return { items_total, total: items_total + (shipFee || 0) };
}

export type CreatePayload = {
  header_note: string;
  items: Array<{ name: string; qty: number; unit_price: number; note: string | null }>;
  ship_fee: number;
  transfer_amount: number;
};

/** Dòng chưa gõ tên bị BỎ chứ không báo lỗi: người ta bấm "thêm dòng" rồi đổi ý là chuyện xảy ra
 *  mỗi ngày, và một hộp thoại lỗi ở đây chỉ chặn đường in tờ giấy. */
export function toCreatePayload(draft: {
  headerNote: string;
  lines: DraftLine[];
  shipFee: number;
  transferAmount: number;
}): CreatePayload {
  return {
    header_note: draft.headerNote.trim(),
    items: draft.lines
      .filter((l) => l.name.trim().length > 0)
      .map((l) => ({
        name: l.name.trim(),
        qty: l.qty,
        unit_price: l.unit_price,
        note: l.note.trim() || null,
      })),
    ship_fee: draft.shipFee || 0,
    transfer_amount: draft.transferAmount || 0,
  };
}
