import { describe, expect, it } from 'vitest';
import { describePayment } from './payment-describe.js';

describe('câu thanh toán trong nhật ký bàn', () => {
  it('không có chuyển khoản → tiền mặt', () => {
    expect(describePayment(250000, 0, null)).toBe(' · tiền mặt');
  });

  it('chuyển khoản toàn bộ → nói rõ tiền về mã nào', () => {
    expect(describePayment(250000, 250000, 'TK Thuý – VCB')).toBe(' · chuyển khoản → TK Thuý – VCB');
  });

  it('trả cả hai → tách hai con số, vì người đếm két chỉ khớp phần tiền mặt', () => {
    expect(describePayment(250000, 100000, 'MoMo mẹ')).toBe(
      ' · tiền mặt 150.000đ + chuyển khoản 100.000đ → MoMo mẹ',
    );
  });

  it('đơn bị sửa cho tổng tụt xuống dưới phần đã chuyển → KHÔNG được ra tiền mặt âm', () => {
    expect(describePayment(50000, 100000, 'TK bố')).toBe(' · chuyển khoản → TK bố');
  });
});
