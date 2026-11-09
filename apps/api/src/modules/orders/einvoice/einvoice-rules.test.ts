// Test luật tự phát hành hoá đơn M cho đơn thu vào QR hộ kinh doanh (chốt 2026-10-13).
import { describe, expect, it } from 'vitest';
import {
  EINVOICE_MAX_ATTEMPTS,
  buildEInvoiceDraft,
  einvoiceLockReason,
  hkdMixedPaymentError,
  initialEInvoiceStatus,
  statusAfterFailure,
  statusAfterError,
  einvoiceAmountMismatch,
  type EInvoiceSourceItem,
} from './einvoice-rules.js';

const item = (name: string, price: number, qty: number, extra: Partial<EInvoiceSourceItem> = {}): EInvoiceSourceItem => ({
  menu_item_name: name,
  menu_item_price: price,
  qty,
  state: 'SERVED',
  is_note: false,
  ...extra,
});

describe('hkdMixedPaymentError', () => {
  it('cho qua khi chuyển đủ tổng vào mã HKD', () => {
    expect(hkdMixedPaymentError(true, 250_000, 250_000)).toBeNull();
  });

  it('chặn khi chuyển thiếu vào mã HKD (phần còn lại là tiền mặt)', () => {
    expect(hkdMixedPaymentError(true, 200_000, 250_000)).toMatch(/ĐỦ tổng đơn/);
  });

  it('không đụng tới mã QR không phải HKD', () => {
    expect(hkdMixedPaymentError(false, 200_000, 250_000)).toBeNull();
  });
});

describe('initialEInvoiceStatus', () => {
  const base = { isHkd: true, enabled: true, transferAmount: 250_000, misaCopied: false };

  it('xếp hàng đợi khi công tắc bật + mã HKD + có chuyển khoản', () => {
    expect(initialEInvoiceStatus(base)).toBe('PENDING');
  });

  it('không xếp khi công tắc tắt', () => {
    expect(initialEInvoiceStatus({ ...base, enabled: false })).toBeNull();
  });

  it('không xếp với mã QR thường', () => {
    expect(initialEInvoiceStatus({ ...base, isHkd: false })).toBeNull();
  });

  it('không xếp khi thu ngân đã tick tay Misa — tránh ra hai hoá đơn cho một bữa', () => {
    expect(initialEInvoiceStatus({ ...base, misaCopied: true })).toBeNull();
  });
});

describe('statusAfterFailure', () => {
  it('còn lượt thì quay lại hàng đợi, hết lượt thì dừng chờ người bấm', () => {
    expect(statusAfterFailure(EINVOICE_MAX_ATTEMPTS - 1)).toBe('PENDING');
    expect(statusAfterFailure(EINVOICE_MAX_ATTEMPTS)).toBe('FAILED');
  });
});

describe('einvoiceLockReason', () => {
  it('khoá đơn đã phát hành và nêu số hoá đơn', () => {
    expect(einvoiceLockReason('ISSUED', '0000123')).toMatch(/số 0000123/);
  });

  it('khoá đơn đang phát hành', () => {
    expect(einvoiceLockReason('PENDING', null)).not.toBeNull();
  });

  it('không khoá đơn lỗi hoặc đơn ngoài luồng tự động', () => {
    expect(einvoiceLockReason('FAILED', null)).toBeNull();
    expect(einvoiceLockReason(null, null)).toBeNull();
  });
});

describe('buildEInvoiceDraft', () => {
  it('gộp dòng cùng tên + cùng giá, bỏ món huỷ và ghi chú', () => {
    const draft = buildEInvoiceDraft(
      {
        id: 'o1',
        ship_fee: null,
        items: [
          item('Bia Hà Nội', 20_000, 2, { menu_item_id: 'm-bia' }),
          item('Bia Hà Nội', 20_000, 4, { menu_item_id: 'm-bia' }),
          // Món đã xoá khỏi menu (menu_item_id không còn trong bảng) → đơn vị trống.
          item('Lẩu thái', 250_000, 1, { menu_item_id: 'm-da-xoa' }),
          item('Lẩu thái', 250_000, 1, { state: 'CANCELLED' }),
          item('Ít cay', 0, 1, { is_note: true }),
        ],
      },
      new Map([['m-bia', 'lon']]),
    );
    expect(draft.lines).toEqual([
      { name: 'Bia Hà Nội', unit: 'lon', qty: 6, unit_price: 20_000, amount: 120_000 },
      { name: 'Lẩu thái', unit: null, qty: 1, unit_price: 250_000, amount: 250_000 },
    ]);
    expect(draft.total).toBe(370_000);
    expect(draft.buyer_name).toBe('Bán cho người tiêu dùng');
    expect(draft.ref_id).toBe('o1');
  });

  it('cùng tên khác giá thì tách dòng', () => {
    const draft = buildEInvoiceDraft({
      id: 'o2',
      ship_fee: 0,
      items: [item('Khăn lạnh', 2_000, 2), item('Khăn lạnh', 3_000, 1)],
    });
    expect(draft.lines).toHaveLength(2);
  });

  it('có phí ship thì thêm dòng riêng để tổng hoá đơn khớp tiền khách chuyển', () => {
    const draft = buildEInvoiceDraft({ id: 'o3', ship_fee: 15_000, items: [item('Cơm rang', 50_000, 1)] });
    expect(draft.lines.at(-1)).toEqual({ name: 'Phí giao hàng', unit: null, qty: 1, unit_price: 15_000, amount: 15_000 });
    expect(draft.total).toBe(65_000);
  });
});

describe('statusAfterError (2026-11-09)', () => {
  it('lỗi CHẮC CHẮN + có người đứng nhìn → FAILED ngay để họ xuất tay', () => {
    expect(statusAfterError({ attempts: 1, attended: true, uncertain: false })).toBe('FAILED');
  });

  it('lỗi CHẮC CHẮN ở poller → thử lại tới hết lượt', () => {
    expect(statusAfterError({ attempts: 1, attended: false, uncertain: false })).toBe('PENDING');
    expect(statusAfterError({ attempts: EINVOICE_MAX_ATTEMPTS, attended: false, uncertain: false })).toBe('FAILED');
  });

  it('lỗi KHÔNG BIẾT không dừng sớm kể cả khi có người nhìn — máy tra lại theo RefID', () => {
    expect(statusAfterError({ attempts: 1, attended: true, uncertain: true })).toBe('PENDING');
    expect(statusAfterError({ attempts: EINVOICE_MAX_ATTEMPTS, attended: true, uncertain: true })).toBe('FAILED');
  });
});

describe('einvoiceAmountMismatch', () => {
  it('khớp tiền chuyển khoản → null', () => {
    expect(einvoiceAmountMismatch(370_000, 370_000)).toBeNull();
  });

  it('lệch → câu báo có cả hai số, không xuất', () => {
    expect(einvoiceAmountMismatch(370_000, 350_000)).toMatch(/370\.000đ.*350\.000đ.*không xuất/);
  });
});
