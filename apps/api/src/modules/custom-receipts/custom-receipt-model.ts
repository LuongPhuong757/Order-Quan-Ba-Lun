// Biến một HOÁ ĐƠN TỰ DO thành đầu vào của `buildReceipt` — hàm dựng hoá đơn THẬT (M6.D-01).
//
// Cả module này tồn tại để KHÔNG có hàm dựng tờ giấy thứ hai. Yêu cầu của chủ quán là tờ tự do
// trông y hệt hoá đơn thật; hai hàm dựng song song thì chúng chỉ giống nhau đúng một ngày — ngày
// viết xong — rồi lặng lẽ tách ra ở lần đầu tiên ai đó sửa chữ trên hoá đơn, và không test nào
// bắt được vì cả hai đều "đúng" theo test của riêng mình.
//
// Module THUẦN: không DB, không giờ hệ thống ngầm. Mọi thứ đi qua tham số.

import type { ReceiptInput } from '../printing/receipt-model.js';

/** Một dòng trên tờ hoá đơn tự do. KHÔNG tham chiếu `menu_items`: tên và giá được chụp lại tại
 *  chỗ, nên món bị xoá khỏi menu sau đó vẫn in lại được y nguyên. */
export type CustomReceiptItem = {
  name: string;
  qty: number;
  unit_price: number;
  note: string | null;
};

/** Phần dữ liệu của một tờ hoá đơn tự do mà việc dựng giấy cần tới. Trùng với entity nhưng khai
 *  riêng để module này test được mà không cần TypeORM. */
export type CustomReceiptData = {
  id: string;
  header_note: string;
  items: CustomReceiptItem[];
  ship_fee: number;
  transfer_amount: number;
  created_by_full_name: string | null;
  created_at: number;
};

export type CustomReceiptStore = { name: string; address: string; phone: string };

/**
 * Dựng "đơn ảo" cho `buildReceipt`.
 *
 * Đơn ảo này KHÔNG bao giờ chạm DB và không có dòng nào trong `orders` — đó chính là lý do tính
 * năng này không đụng tới doanh thu (M6.D-07).
 */
export function toReceiptInput(
  receipt: CustomReceiptData,
  store: CustomReceiptStore,
  opts: { reprint: boolean; nowMs: number; paymentQrLabel?: string | null; tzOffsetMinutes?: number },
): ReceiptInput {
  return {
    order: {
      id: receipt.id,
      table_code: '',
      // Nhãn đầu tờ đi qua `target_label` chứ không qua `table_code`: người in gõ tự do ở đó
      // ("Mang về", tên khách...), mà `table_code` bị `describeTarget` thêm tiền tố "Bàn ".
      target_label: receipt.header_note,
      fulfillment_type: null,
      source: 'STAFF',
      ship_fee: receipt.ship_fee,
      transfer_amount: receipt.transfer_amount,
      payment_qr_label: opts.paymentQrLabel ?? null,
      closed_at: receipt.created_at,
      opened_at: receipt.created_at,
      // Tờ tự do không bao giờ là giấy ghi nợ: nó in ra là để đưa cho khách như một biên nhận
      // đã trả tiền. Ghi nợ là nghiệp vụ của đơn thật, có chỗ theo dõi riêng.
      is_paid: true,
      debt_at: null,
      debt_note: null,
      checked_out_by_full_name: receipt.created_by_full_name,
      customer_name: null,
      customer_phone: null,
      customer_address: null,
    },
    items: receipt.items.map((it) => ({
      menu_item_name: it.name,
      menu_item_price: it.unit_price,
      qty: it.qty,
      // Mọi dòng đều tính tiền: tờ tự do không có khái niệm món bị huỷ, người in chỉ việc xoá
      // dòng đó đi trước khi bấm In.
      state: 'SERVED',
      is_note: false,
      note: it.note,
    })),
    store,
    reprint: opts.reprint,
    nowMs: opts.nowMs,
    tzOffsetMinutes: opts.tzOffsetMinutes,
  };
}

/** Tổng tiền của một tờ, dùng lúc TẠO để chốt `items_total`/`total` vào DB. Công thức phải khớp
 *  `computeCheckoutTotals` — cùng một phép cộng, nhưng ở đây không có món huỷ để lọc. */
export function computeCustomTotals(items: CustomReceiptItem[], shipFee: number) {
  const items_total = items.reduce((sum, it) => sum + it.unit_price * it.qty, 0);
  return { items_total, total: items_total + shipFee };
}
