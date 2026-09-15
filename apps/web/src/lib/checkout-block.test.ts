import { describe, expect, it } from 'vitest';
import { checkoutBlockReason, stepBlockReason } from './checkout-block.ts';

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

describe('chặn theo TỪNG MÀN (hộp thoại 4 bước)', () => {
  it('màn soát bill không chặn gì — chưa ai hỏi hình thức ở đó', () => {
    expect(stepBlockReason('items', S(null))).toBeNull();
  });

  it('màn soát bill LÀ màn chốt khi chỉ thu được tiền mặt → kiểm trọn bộ', () => {
    expect(stepBlockReason('items', S('CASH'))).toBeNull();
  });

  it('màn 2 chỉ đòi chọn hình thức — không đòi mã QR của màn chưa hiện ra', () => {
    expect(stepBlockReason('mode', S(null))).toBe('Vui lòng chọn khách trả bằng gì');
    expect(stepBlockReason('mode', S('TRANSFER', false, 985000))).toBeNull();
    expect(stepBlockReason('mode', S('SPLIT', false, 0))).toBeNull();
  });

  it('màn 2 + tiền mặt là cú bấm GHI TIỀN nên kiểm trọn bộ', () => {
    expect(stepBlockReason('mode', S('CASH'))).toBeNull();
  });

  it('màn 3 đòi mã QR trước, rồi mới tới số tiền', () => {
    expect(stepBlockReason('qr', S('SPLIT', false, 0))).toBe('Vui lòng chọn mã QR để thanh toán');
    expect(stepBlockReason('qr', S('SPLIT', true, 0))).toBe('Nhập số tiền khách chuyển khoản');
    expect(stepBlockReason('qr', S('SPLIT', true, 500000))).toBeNull();
    // Chuyển khoản TOÀN BỘ không có gì để nhập — số tiền chính là tổng.
    expect(stepBlockReason('qr', S('TRANSFER', true, 985000))).toBeNull();
  });

  it('màn cuối kiểm lại trọn bộ — người dùng lùi lại sửa được, không tin hai màn trước', () => {
    expect(stepBlockReason('bill', S('TRANSFER', false, 985000))).toBe('Vui lòng chọn mã QR để thanh toán');
    expect(stepBlockReason('bill', S('TRANSFER', true, 985000))).toBeNull();
  });
});
