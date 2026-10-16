import { describe, it, expect } from 'vitest';
import { resolvePaidFrom } from './paid-from.js';

const VCB = { id: 'acc-vcb', label: 'VCB Quán', is_active: true };
const TAT = { id: 'acc-cu', label: 'TK cũ', is_active: false };

describe('resolvePaidFrom', () => {
  it('tiền mặt luôn xoá tài khoản, kể cả khi màn gửi kèm id', () => {
    expect(resolvePaidFrom('CASH', 'acc-vcb', VCB)).toEqual({ paid_from_account_id: null, paid_from_label: null });
  });

  it('chuyển khoản lưu id + snapshot tên mã QR', () => {
    expect(resolvePaidFrom('TRANSFER', 'acc-vcb', VCB)).toEqual({
      paid_from_account_id: 'acc-vcb',
      paid_from_label: 'VCB Quán',
    });
  });

  it('chuyển khoản mà không chọn tài khoản thì từ chối', () => {
    expect(() => resolvePaidFrom('TRANSFER', null, null)).toThrow(/phải chọn/);
    expect(() => resolvePaidFrom('TRANSFER', '', null)).toThrow(/phải chọn/);
  });

  it('tài khoản không tồn tại thì từ chối', () => {
    expect(() => resolvePaidFrom('TRANSFER', 'khong-co', null)).toThrow(/không tìm thấy/i);
  });

  // 2026-10-16 chủ quán chốt: "Ngừng dùng" ở Cài đặt = ngừng NHẬN TIỀN KHÁCH. Tài khoản đó vẫn
  // là tiền thật của quán, vẫn chuyển ra trả NCC được.
  it('tài khoản đã ngừng nhận tiền khách vẫn dùng trả NCC được', () => {
    expect(resolvePaidFrom('TRANSFER', 'acc-cu', TAT)).toEqual({
      paid_from_account_id: 'acc-cu',
      paid_from_label: 'TK cũ',
    });
  });

  it('sửa mà giữ nguyên tài khoản cũ đã tắt/xoá thì vẫn cho, giữ nhãn cũ', () => {
    const cu = { paid_from_account_id: 'acc-cu', paid_from_label: 'TK cũ' };
    expect(resolvePaidFrom('TRANSFER', 'acc-cu', null, cu)).toEqual(cu);
    expect(resolvePaidFrom('TRANSFER', 'acc-cu', TAT, cu)).toEqual(cu);
  });

  it('sửa sang tài khoản KHÁC thì tài khoản mới phải tồn tại', () => {
    const cu = { paid_from_account_id: 'acc-vcb', paid_from_label: 'VCB Quán' };
    expect(() => resolvePaidFrom('TRANSFER', 'khong-co', null, cu)).toThrow(/không tìm thấy/i);
    expect(resolvePaidFrom('TRANSFER', 'acc-cu', TAT, cu)).toEqual({
      paid_from_account_id: 'acc-cu',
      paid_from_label: 'TK cũ',
    });
  });
});
