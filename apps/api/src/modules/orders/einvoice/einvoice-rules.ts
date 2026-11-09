// Luật TỰ PHÁT HÀNH HOÁ ĐƠN M cho đơn thu vào QR hộ kinh doanh (chốt với chủ quán 2026-10-13).
//
// Tách thành hàm thuần khỏi `OrdersService.checkout()` — vốn nằm trong transaction dài, không test
// được nếu không dựng MySQL — cùng lý do `checkout-total.ts`: luật tiền/luật thuế phải có bằng
// chứng riêng, không được chỉ nằm lẫn trong một hàm 150 dòng.
//
// Bốn quyết định của chủ quán mà file này mã hoá, đừng "tối ưu" mất cái nào:
//   1. Chỉ đơn có tiền vào mã QR mang cờ `is_hkd` mới xuất hoá đơn — tiền mặt và QR khác thì không.
//   2. LUÔN cấm trả hỗn hợp với mã HKD (kể cả khi công tắc tắt): hoá đơn phải khớp đúng tiền về TK HKD.
//   3. Công tắc `hkd_einvoice_enabled` chỉ quyết định đơn MỚI có vào hàng đợi hay không. Đơn đã
//      vào hàng đợi thì vẫn được phát hành nốt dù chủ quán tắt giữa chừng — tắt công tắc không
//      được bỏ rơi đơn đang dở.
//   4. Tự động thử tối đa `EINVOICE_MAX_ATTEMPTS` lần, rồi nằm chờ người bấm "Phát hành lại".

import type { CheckoutPricedItem } from '../checkout-total.js';

export type EInvoiceStatus = 'PENDING' | 'ISSUED' | 'FAILED';

/** Số lần poller tự gọi meInvoice trước khi bỏ cuộc và chờ người bấm. Ba lần × chu kỳ 30 giây
 *  ≈ 1,5 phút — đủ vượt một lần chập mạng, không đủ lâu để thu ngân quên mất đơn đó. */
export const EINVOICE_MAX_ATTEMPTS = 3;

/** Chặn trả hỗn hợp vào mã HKD. Trả `null` khi hợp lệ, hoặc câu báo lỗi cho người đứng quầy.
 *
 *  `transferAmount = 0` (thu tiền mặt toàn bộ) với `isHkd = true` không xảy ra trên FE — đã chọn
 *  mã QR tức là có chuyển khoản — nhưng nếu xảy ra thì cũng không phải hỗn hợp, cho qua. */
export function hkdMixedPaymentError(isHkd: boolean, transferAmount: number, total: number): string | null {
  if (!isHkd || transferAmount <= 0) return null;
  if (transferAmount === total) return null;
  return 'Mã QR hộ kinh doanh phải chuyển khoản ĐỦ tổng đơn — không trả kèm tiền mặt. ' +
    'Khách muốn trả một phần tiền mặt thì chọn mã QR khác.';
}

/** Trạng thái hoá đơn ngay lúc thu tiền xong. `null` = đơn không thuộc luồng tự động.
 *
 *  `misaCopied = true` thắng: thu ngân đã tick tay "đã lên MISA" nghĩa là hoá đơn đã/sẽ được làm
 *  tay — cho vào hàng đợi nữa là ra HAI hoá đơn cho một bữa ăn. (Khi công tắc bật, FE đã ẩn ô tick,
 *  nhánh này chỉ là chốt chặn cho request cũ / gọi lén.) */
export function initialEInvoiceStatus(p: {
  isHkd: boolean;
  enabled: boolean;
  transferAmount: number;
  misaCopied: boolean;
}): EInvoiceStatus | null {
  if (!p.enabled || !p.isHkd || p.transferAmount <= 0 || p.misaCopied) return null;
  return 'PENDING';
}

/** Kết quả một lần gọi meInvoice hỏng → đơn quay lại hàng đợi hay dừng chờ người. */
export function statusAfterFailure(attempts: number): 'PENDING' | 'FAILED' {
  return attempts >= EINVOICE_MAX_ATTEMPTS ? 'FAILED' : 'PENDING';
}

/** Đầu câu lỗi cho trường hợp KHÔNG BIẾT hoá đơn đã ra hay chưa. FE dò đúng chuỗi này để dặn
 *  người thu ĐỪNG xuất tay (xuất tay lúc này có thể ra hoá đơn thứ hai). */
export const EINVOICE_UNCERTAIN_PREFIX = 'CHƯA XÁC MINH';

/** Trạng thái sau một lần lỗi (2026-11-09).
 *  - Lỗi CHẮC CHẮN chưa phát hành (MISA từ chối rõ, thiếu cấu hình, lệch tiền): có người đứng nhìn
 *    (`attended`, hộp thanh toán) → FAILED ngay để họ xử lý; poller → thử lại tới hết lượt.
 *  - Lỗi KHÔNG BIẾT (`uncertain`): KHÔNG dừng sớm kể cả khi có người nhìn — máy tra lại theo RefID
 *    ở lượt sau là cách duy nhất biết chắc; dừng sớm là đẩy người thu đi xuất tay mù. Hết lượt thì
 *    FAILED kèm câu dặn kiểm tra trên meInvoice trước. */
export function statusAfterError(p: { attempts: number; attended: boolean; uncertain: boolean }): 'PENDING' | 'FAILED' {
  if (p.uncertain) return statusAfterFailure(p.attempts);
  return p.attended ? 'FAILED' : statusAfterFailure(p.attempts);
}

/** Chốt chặn tiền: hoá đơn phải đúng bằng tiền khách đã chuyển vào TK hộ kinh doanh. Luồng tự
 *  động chỉ nhận đơn chuyển khoản ĐỦ (cấm trả hỗn hợp), nên hai số này phải bằng nhau — lệch là có
 *  đường nào đó sửa đơn sau khi thu, và xuất ra là hoá đơn sai số tiền. `null` = khớp. */
export function einvoiceAmountMismatch(invoiceTotal: number, transferAmount: number): string | null {
  if (invoiceTotal === transferAmount) return null;
  return `Tiền trên hoá đơn (${invoiceTotal.toLocaleString('vi-VN')}đ) khác tiền chuyển khoản ` +
    `(${transferAmount.toLocaleString('vi-VN')}đ) — không xuất, kiểm tra lại đơn`;
}

/** Đơn đang/đã phát hành thì KHOÁ việc chuyển sang ghi nợ và việc tick/bỏ tick Misa tay: hoá đơn
 *  đã nằm bên cơ quan thuế, sửa đơn trong app mà hoá đơn vẫn còn là hai bên lệch nhau. `FAILED`
 *  thì chưa có hoá đơn nào — cho đổi. Trả câu báo lỗi hoặc `null`. */
export function einvoiceLockReason(status: EInvoiceStatus | null, invoiceNo: string | null): string | null {
  if (status === 'ISSUED') {
    return `Đơn đã ra hoá đơn${invoiceNo ? ` số ${invoiceNo}` : ''} — xử lý trên meInvoice trước rồi mới sửa đơn`;
  }
  if (status === 'PENDING') return 'Đơn đang được phát hành hoá đơn — đợi xong rồi thử lại';
  return null;
}

// ─── Nội dung hoá đơn ─────────────────────────────────────────────────────

/** `unit` = đơn vị tính lấy từ menu (đĩa, phần, chai…) — `null` khi không có (phí ship, món đã
 *  xoá khỏi menu). Hoá đơn CukCuk của quán in cột này, hoá đơn app phải giống. */
export type EInvoiceLine = { name: string; unit: string | null; qty: number; unit_price: number; amount: number };

export type EInvoiceDraft = {
  /** Mã tham chiếu gửi sang meInvoice = `orders.id`. Dùng để chống phát hành trùng khi gọi lại. */
  ref_id: string;
  /** Toàn khách lẻ (chủ quán chốt 2026-10-13) — không hỏi tên/MST người mua. */
  buyer_name: string;
  lines: EInvoiceLine[];
  total: number;
};

export type EInvoiceSourceItem = CheckoutPricedItem & {
  menu_item_name: string;
  is_note: boolean;
  menu_item_id?: string | null;
};

/** Đúng câu hoá đơn CukCuk của quán đang in ở ô tên đơn vị / họ tên / địa chỉ người mua
 *  (đối chiếu hoá đơn 2C26MYY số 00003289, 2026-11-09) — hai đường xuất phải ra hoá đơn giống nhau. */
export const EINVOICE_BUYER_RETAIL = 'Bán cho người tiêu dùng';
export const EINVOICE_SHIP_FEE_LINE = 'Phí giao hàng';

/** Dựng nội dung hoá đơn từ đơn đã chốt. GỘP các dòng cùng tên + cùng giá: một bàn gọi thêm bia 3
 *  lượt là 3 dòng trong app, nhưng trên hoá đơn khách cầm về phải là "Bia × 6", không phải 3 dòng
 *  lặp. Bỏ món huỷ (cùng luật tính tiền ở `computeCheckoutTotals`) và dòng ghi chú (giá 0, không
 *  phải hàng hoá). Phí ship là một dòng riêng: nó nằm trong tổng thu nên phải có trên hoá đơn,
 *  không thì tổng hoá đơn lệch tiền khách chuyển. */
export function buildEInvoiceDraft(
  order: {
    id: string;
    items: EInvoiceSourceItem[];
    ship_fee: number | null | undefined;
  },
  /** `menu_item_id` → đơn vị tính. Thiếu = cột đơn vị tính để trống (hoá đơn vẫn hợp lệ). */
  units: ReadonlyMap<string, string> = new Map(),
): EInvoiceDraft {
  const merged = new Map<string, EInvoiceLine>();
  for (const it of order.items) {
    if (it.is_note || it.state === 'CANCELLED') continue;
    const key = `${it.menu_item_name}\u0000${it.menu_item_price}`;
    const prev = merged.get(key);
    const qty = (prev?.qty ?? 0) + it.qty;
    const unit = prev?.unit ?? (it.menu_item_id ? units.get(it.menu_item_id)?.trim() || null : null);
    merged.set(key, {
      name: it.menu_item_name,
      unit,
      qty,
      unit_price: it.menu_item_price,
      amount: qty * it.menu_item_price,
    });
  }
  const lines = [...merged.values()];
  const shipFee = order.ship_fee ?? 0;
  if (shipFee > 0) lines.push({ name: EINVOICE_SHIP_FEE_LINE, unit: null, qty: 1, unit_price: shipFee, amount: shipFee });
  return {
    ref_id: order.id,
    buyer_name: EINVOICE_BUYER_RETAIL,
    lines,
    total: lines.reduce((s, l) => s + l.amount, 0),
  };
}
