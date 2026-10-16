import { describe, expect, it } from 'vitest';
import { accountLabelMap } from './account-label.js';

const row = (label: string, account_no: string | null, is_active = true, sort_order = 0) => ({
  label,
  account_no,
  is_active,
  sort_order,
});

describe('accountLabelMap', () => {
  it('tra tên mã QR theo số tài khoản', () => {
    const m = accountLabelMap([row('TPBank HKD', '0123456789'), row('MB cá nhân', '9988776655')]);
    expect(m.get('0123456789')).toBe('TPBank HKD');
    expect(m.get('9988776655')).toBe('MB cá nhân');
  });

  it('cùng số tài khoản thì lấy tên của mã ĐANG DÙNG, không lấy mã đã tắt', () => {
    const m = accountLabelMap([row('Tên cũ', '0123456789', false, 0), row('Tên mới', '0123456789', true, 5)]);
    expect(m.get('0123456789')).toBe('Tên mới');
  });

  it('mã đã tắt vẫn có tên — giao dịch cũ về tài khoản đó vẫn cần nhận ra', () => {
    expect(accountLabelMap([row('MB cũ', '111122223333', false)]).get('111122223333')).toBe('MB cũ');
  });

  it('bỏ qua mã dạng ảnh (không có số tài khoản)', () => {
    expect(accountLabelMap([row('MoMo', null)]).size).toBe(0);
  });
});
