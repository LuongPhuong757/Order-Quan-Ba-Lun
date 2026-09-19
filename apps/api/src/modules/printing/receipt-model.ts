// Dựng NỘI DUNG tờ hoá đơn từ dữ liệu đơn. Module THUẦN: không canvas, không DB, không giờ
// hệ thống ngầm — mọi thứ đi qua tham số. Nhờ vậy test được từng dòng chữ sẽ in ra giấy mà
// không cần máy in lẫn MySQL.
//
// Tách rời khỏi `receipt-render.ts` (vẽ) có chủ đích: "in cái gì" là luật kinh doanh và thay
// đổi theo yêu cầu của quán; "vẽ thế nào" là kỹ thuật đồ hoạ. Gộp chung thì mỗi lần đổi chữ
// trên hoá đơn lại phải đọc code tính toạ độ pixel.

import { computeCheckoutTotals, type CheckoutPricedItem } from '../orders/checkout-total.js';

/** Tự nhóm hàng nghìn bằng dấu chấm thay vì `toLocaleString('vi-VN')`.
 *
 *  Không phải để tránh ICU cho vui: đây là chữ sẽ nằm trên giấy đưa cho khách, và
 *  `toLocaleString` âm thầm đổi sang dấu phẩy kiểu Mỹ nếu runtime thiếu dữ liệu locale.
 *  Một hàm 4 dòng thì cho kết quả giống hệt nhau trên máy dev, trong container, và trong test. */
export function formatVnd(value: number): string {
  const n = Math.round(value);
  const sign = n < 0 ? '-' : '';
  return sign + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + 'đ';
}

/** Giờ phút ngày tháng theo múi giờ quán. Nhận offset phút để test không phụ thuộc TZ máy. */
export function formatStamp(ms: number, tzOffsetMinutes = 7 * 60): string {
  const d = new Date(ms + tzOffsetMinutes * 60_000);
  const p = (v: number) => String(v).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())} ${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/** Mã ngắn cho khách đọc qua điện thoại. 6 ký tự hex cuối của uuid là đủ phân biệt trong
 *  phạm vi một quán, và ngắn tới mức đọc hết được trong một hơi. */
export function shortCode(orderId: string): string {
  return orderId.replace(/-/g, '').slice(-6).toUpperCase();
}

export type ReceiptLine =
  | { kind: 'title'; text: string }
  | { kind: 'sub'; text: string }
  | { kind: 'rule' }
  | { kind: 'meta'; label: string; value: string }
  | { kind: 'item'; name: string; qty: number; unitPrice: number; amount: number }
  | { kind: 'note'; text: string }
  | { kind: 'total'; label: string; value: string; strong?: boolean }
  | { kind: 'center'; text: string; strong?: boolean }
  | { kind: 'gap'; px: number };

export type ReceiptItemInput = CheckoutPricedItem & {
  menu_item_name: string;
  is_note: boolean;
  note: string | null;
};

export type ReceiptInput = {
  order: {
    id: string;
    table_code: string;
    fulfillment_type: string | null;
    source: string;
    ship_fee: number | null;
    transfer_amount: number;
    payment_qr_label: string | null;
    closed_at: number | null;
    opened_at: number;
    checked_out_by_full_name: string | null;
    customer_name: string | null;
    customer_phone: string | null;
    customer_address: string | null;
  };
  items: ReceiptItemInput[];
  store: { name: string; address: string; phone: string };
  /** Lần in lại (khác lần in tự động lúc thanh toán) — đóng dấu lên giấy để người cầm hai tờ
   *  giống nhau biết ngay tờ nào là bản sao, tránh thu tiền hai lần. */
  reprint: boolean;
  /** Mốc thời gian dùng để đóng dấu bản in lại. */
  nowMs: number;
  tzOffsetMinutes?: number;
};

/** Tên loại đơn hiện trên hoá đơn. `table_code` là snapshot nên bàn đổi tên vẫn in đúng tên
 *  lúc khách ngồi. */
function describeTarget(order: ReceiptInput['order']): string {
  if (order.fulfillment_type === 'DELIVERY') return 'Giao tận nơi';
  if (order.fulfillment_type === 'PICKUP') return 'Khách tự lấy';
  return `Bàn ${order.table_code}`;
}

/**
 * Dựng danh sách dòng của tờ hoá đơn.
 *
 * Ba luật về món, cố ý khác nhau và đều có lý do:
 *  - Món `CANCELLED`: KHÔNG in. Khách không trả tiền món bị huỷ, in ra chỉ khiến họ đếm lại
 *    tổng rồi thắc mắc.
 *  - Món chưa mang ra (PENDING/KITCHEN): VẪN IN và vẫn tính tiền — luật quán đổi 2026-09-08,
 *    tiền tính theo `computeCheckoutTotals`, ở đây chỉ hiển thị cho khớp.
 *  - Dòng ghi chú (`is_note`, giá 0): in thụt vào dưới, KHÔNG in cột tiền. In "0đ" cạnh một
 *    câu ghi chú trông hệt như một món được tặng, và đã đủ gây tranh cãi ở quầy.
 */
export function buildReceipt(input: ReceiptInput): ReceiptLine[] {
  const { order, store, items } = input;
  const tz = input.tzOffsetMinutes ?? 7 * 60;
  const totals = computeCheckoutTotals(items, order.ship_fee);
  const lines: ReceiptLine[] = [];

  lines.push({ kind: 'title', text: store.name });
  if (store.address) lines.push({ kind: 'sub', text: store.address });
  if (store.phone) lines.push({ kind: 'sub', text: `ĐT: ${store.phone}` });
  lines.push({ kind: 'gap', px: 6 });
  lines.push({ kind: 'center', text: 'HOÁ ĐƠN THANH TOÁN', strong: true });
  if (input.reprint) {
    lines.push({ kind: 'center', text: `(BẢN IN LẠI ${formatStamp(input.nowMs, tz)})` });
  }
  lines.push({ kind: 'rule' });

  lines.push({ kind: 'meta', label: describeTarget(order), value: `#${shortCode(order.id)}` });
  lines.push({
    kind: 'meta',
    label: 'Thời gian',
    value: formatStamp(order.closed_at ?? order.opened_at, tz),
  });
  if (order.checked_out_by_full_name) {
    lines.push({ kind: 'meta', label: 'Thu ngân', value: order.checked_out_by_full_name });
  }
  // Đơn giao tận nơi: người cầm tờ hoá đơn là shipper, nên địa chỉ và số điện thoại phải nằm
  // trên giấy — không ai mở app ra tra giữa đường.
  if (order.fulfillment_type === 'DELIVERY') {
    if (order.customer_name) lines.push({ kind: 'meta', label: 'Khách', value: order.customer_name });
    if (order.customer_phone) lines.push({ kind: 'meta', label: 'ĐT khách', value: order.customer_phone });
    if (order.customer_address) lines.push({ kind: 'note', text: order.customer_address });
  }
  lines.push({ kind: 'rule' });

  for (const it of items) {
    if (it.state === 'CANCELLED') continue;
    if (it.is_note) {
      lines.push({ kind: 'note', text: it.menu_item_name });
      continue;
    }
    lines.push({
      kind: 'item',
      name: it.menu_item_name,
      qty: it.qty,
      unitPrice: it.menu_item_price,
      amount: it.menu_item_price * it.qty,
    });
    if (it.note) lines.push({ kind: 'note', text: it.note });
  }

  lines.push({ kind: 'rule' });
  // Chỉ tách "tiền món / phí ship" khi THỰC SỰ có phí ship. Đơn tại quán mà in thêm dòng
  // "Phí ship 0đ" thì tờ hoá đơn dài thêm một dòng vô nghĩa trên mỗi bàn, mỗi ngày.
  if (totals.ship_fee > 0) {
    lines.push({ kind: 'total', label: 'Tiền món', value: formatVnd(totals.items_total) });
    lines.push({ kind: 'total', label: 'Phí giao hàng', value: formatVnd(totals.ship_fee) });
  }
  lines.push({ kind: 'total', label: 'TỔNG CỘNG', value: formatVnd(totals.total), strong: true });

  // Hình thức thanh toán suy ra từ `transfer_amount`, không đọc cột riêng — cùng phép suy
  // `payment-describe.ts` dùng cho nhật ký bàn. Hai chỗ nói khác nhau về cùng một đồng tiền
  // là thứ khiến người đối soát cuối ca mất niềm tin vào cả hai.
  const transfer = Math.max(0, order.transfer_amount ?? 0);
  if (transfer <= 0) {
    lines.push({ kind: 'total', label: 'Tiền mặt', value: formatVnd(totals.total) });
  } else {
    // `>=` chứ không `===`, theo đúng `payment-describe.ts`: đơn bị sửa sau khi thu có thể làm
    // tổng tụt xuống dưới phần đã chuyển, và in ra một khoản tiền mặt ÂM thì tệ hơn nhiều.
    if (transfer < totals.total) {
      lines.push({ kind: 'total', label: 'Tiền mặt', value: formatVnd(totals.total - transfer) });
    }
    lines.push({
      kind: 'total',
      label: 'Chuyển khoản',
      value: formatVnd(transfer >= totals.total ? totals.total : transfer),
    });
    // Tên tài khoản nhận đi RIÊNG một dòng chú thích, không nhét vào ngoặc sau chữ "Chuyển
    // khoản": nhãn dài ("MB Bank – Phương") cộng số tiền vượt quá 384 chấm và chữ đè lên số.
    if (order.payment_qr_label) lines.push({ kind: 'note', text: order.payment_qr_label });
  }

  lines.push({ kind: 'gap', px: 10 });
  lines.push({ kind: 'center', text: 'Cảm ơn quý khách!' });
  lines.push({ kind: 'center', text: 'Hẹn gặp lại' });
  return lines;
}

/**
 * Tờ IN THỬ — không gắn với đơn nào.
 *
 * Cố tình in đủ dấu tiếng Việt khó và một dải chữ chạm sát hai mép giấy: hai thứ hay hỏng nhất
 * khi lắp máy mới là dấu bị mất và khổ giấy bị đặt nhầm (máy 80mm in nội dung 58mm thì lệch hẳn
 * sang trái). Nhìn tờ này là biết ngay cả hai có đúng không, không cần đợi khách thật.
 */
export function buildTestPage(
  store: { name: string; address: string; phone: string },
  nowMs: number,
  paperWidthMm = 80,
  dots = 576,
  tzOffsetMinutes = 7 * 60,
): ReceiptLine[] {
  return [
    { kind: 'title', text: store.name },
    { kind: 'gap', px: 4 },
    { kind: 'center', text: 'IN THỬ', strong: true },
    { kind: 'rule' },
    { kind: 'meta', label: 'Thời gian', value: formatStamp(nowMs, tzOffsetMinutes) },
    // In ra ĐÚNG khổ mà phần mềm đang nghĩ. Nếu tờ giấy thật rộng hơn con số này thì chữ chỉ
    // chiếm nửa trái — và dòng này là chỗ duy nhất nói cho người lắp máy biết vì sao.
    { kind: 'meta', label: 'Khổ giấy', value: `${paperWidthMm}mm / ${dots} chấm` },
    { kind: 'gap', px: 6 },
    { kind: 'center', text: 'Kiểm tra dấu tiếng Việt:' },
    { kind: 'center', text: 'Mỳ Quảng ếch — Bún bò Huế' },
    { kind: 'center', text: 'Ổi ươm, cà phê sữa đá, lẩu gà ớt hiểm' },
    { kind: 'rule' },
    // Hai đầu dòng này phải chạm mép trái và mép phải của giấy.
    { kind: 'meta', label: '|◀ mép trái', value: 'mép phải ▶|' },
    { kind: 'gap', px: 6 },
    { kind: 'total', label: 'TỔNG CỘNG', value: formatVnd(1234567), strong: true },
    { kind: 'gap', px: 8 },
    { kind: 'center', text: 'Nếu bạn đọc được tờ này,' },
    { kind: 'center', text: 'máy in đã sẵn sàng.' },
  ];
}

/**
 * PHIẾU GIAO HÀNG — in lúc bấm "Đã giao cho shipper", KHÔNG phải lúc thanh toán.
 *
 * Khác hoá đơn ở một điểm quyết định mọi thứ còn lại: lúc shipper rời quán thì khách CHƯA TRẢ
 * TIỀN. Nên tờ này không phải "hoá đơn thanh toán" mà là tờ giấy shipper mang theo đường —
 * thứ họ cần là địa chỉ, số điện thoại, và số tiền phải thu về.
 *
 * Địa chỉ in to hơn mọi thứ khác: đó là dòng duy nhất người ta phải đọc khi đang ngồi trên xe.
 */
export function buildDeliverySlip(input: ReceiptInput): ReceiptLine[] {
  const { order, store, items } = input;
  const tz = input.tzOffsetMinutes ?? 7 * 60;
  const totals = computeCheckoutTotals(items, order.ship_fee);
  const lines: ReceiptLine[] = [];

  lines.push({ kind: 'title', text: store.name });
  if (store.phone) lines.push({ kind: 'sub', text: `ĐT quán: ${store.phone}` });
  lines.push({ kind: 'gap', px: 6 });
  lines.push({ kind: 'center', text: 'PHIẾU GIAO HÀNG', strong: true });
  if (input.reprint) {
    lines.push({ kind: 'center', text: `(BẢN IN LẠI ${formatStamp(input.nowMs, tz)})` });
  }
  lines.push({ kind: 'rule' });

  lines.push({ kind: 'meta', label: 'Mã đơn', value: `#${shortCode(order.id)}` });
  lines.push({ kind: 'meta', label: 'Giờ rời quán', value: formatStamp(input.nowMs, tz) });
  lines.push({ kind: 'rule' });

  // Khối KHÁCH lên trước danh sách món: shipper cần địa chỉ, không cần biết có mấy bát phở.
  if (order.customer_name) {
    lines.push({ kind: 'center', text: order.customer_name, strong: true });
  }
  if (order.customer_phone) {
    lines.push({ kind: 'center', text: `ĐT: ${order.customer_phone}`, strong: true });
  }
  if (order.customer_address) {
    lines.push({ kind: 'center', text: order.customer_address });
  }
  lines.push({ kind: 'rule' });

  for (const it of items) {
    if (it.state === 'CANCELLED') continue;
    if (it.is_note) {
      lines.push({ kind: 'note', text: it.menu_item_name });
      continue;
    }
    lines.push({
      kind: 'item',
      name: it.menu_item_name,
      qty: it.qty,
      unitPrice: it.menu_item_price,
      amount: it.menu_item_price * it.qty,
    });
    if (it.note) lines.push({ kind: 'note', text: it.note });
  }

  lines.push({ kind: 'rule' });
  if (totals.ship_fee > 0) {
    lines.push({ kind: 'total', label: 'Tiền món', value: formatVnd(totals.items_total) });
    lines.push({ kind: 'total', label: 'Phí giao hàng', value: formatVnd(totals.ship_fee) });
  }

  // Phần đã chuyển khoản trước (nếu có) trừ ra khỏi số shipper phải cầm về. Bình thường lúc
  // rời quán `transfer_amount` = 0, nhưng đơn trả trước thì shipper KHÔNG được thu lần nữa.
  const paid = Math.max(0, order.transfer_amount ?? 0);
  const due = Math.max(0, totals.total - paid);
  if (paid > 0) {
    lines.push({ kind: 'total', label: 'Tổng đơn', value: formatVnd(totals.total) });
    lines.push({ kind: 'total', label: 'Khách đã chuyển', value: formatVnd(paid) });
  }
  lines.push({
    kind: 'total',
    label: due > 0 ? 'CẦN THU' : 'ĐÃ THANH TOÁN',
    value: due > 0 ? formatVnd(due) : formatVnd(totals.total),
    strong: true,
  });

  lines.push({ kind: 'gap', px: 10 });
  lines.push({ kind: 'center', text: 'Cảm ơn quý khách!' });
  return lines;
}
