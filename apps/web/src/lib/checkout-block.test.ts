import { describe, expect, it } from 'vitest';
import { checkoutBlockReason } from './checkout-block.ts';

const S = (mode: 'CASH' | 'TRANSFER' | 'SPLIT' | null, hasPickedQr = false, transferAmount = 0) =>
  ({ mode, hasPickedQr, transferAmount });

describe('khi nào bấm Thanh toán được', () => {
  it('chưa chọn hình thức → chặn, và nói đúng bước ĐANG thiếu', () => {
    expect(checkoutBlockReason(S(null))).toBe('Vui lòng chọn khách trả bằng gì');
  });

  it('tiền mặt → bấm được ngay, không đòi mã QR', () => {
    expect(checkoutBlockReason(S('CASH'))).toBeNull();
  });

  it('chuyển khoản mà chưa chọn mã QR → chặn', () => {
    expect(checkoutBlockReason(S('TRANSFER', false, 985000))).toBe('Vui lòng chọn mã QR để thanh toán');
  });

  it('chuyển khoản đã chọn mã → bấm được, KHÔNG đòi ảnh bill (ảnh là tuỳ chọn)', () => {
    expect(checkoutBlockReason(S('TRANSFER', true, 985000))).toBeNull();
  });

  it('cả hai: chọn mã rồi nhưng chưa nhập tiền → chặn ở bước nhập tiền', () => {
    expect(checkoutBlockReason(S('SPLIT', true, 0))).toBe('Nhập số tiền khách chuyển khoản');
  });

  it('cả hai: đủ mã và tiền → bấm được', () => {
    expect(checkoutBlockReason(S('SPLIT', true, 500000))).toBeNull();
  });

  it('cả hai mà chưa chọn mã → nói về MÃ QR trước, không nhảy sang chuyện tiền', () => {
    // Thứ tự các nhánh phải theo thứ tự người dùng gặp trên màn hình.
    expect(checkoutBlockReason(S('SPLIT', false, 0))).toBe('Vui lòng chọn mã QR để thanh toán');
  });
});
