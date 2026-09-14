// Luật kiểm mã QR nhận tiền. Test nằm bên `apps/api` vì `packages/schemas` chưa có runner riêng,
// còn luật thì thuần nên chạy được không cần MySQL.
//
// Vì sao nhóm luật này đáng có test: một hàng hỏng trong bảng `payment_qr_accounts` KHÔNG lộ ra
// lúc lưu — nó lộ ra ở hộp thoại thu tiền, đúng lúc khách đang đứng đợi trả tiền và không ai có
// thời gian sửa cấu hình.
import { describe, expect, it } from 'vitest';
import {
  VIETQR_BANKS,
  bankNameFromBin,
  validatePaymentQrDraft,
} from '@order/schemas';

const BANK_OK = {
  kind: 'BANK' as const,
  label: 'TK Thuý – VCB',
  bank_bin: '970436',
  account_no: '0123456789',
  account_name: 'LUONG THI THUY',
};

describe('validatePaymentQrDraft — mã ngân hàng', () => {
  it('đủ ô thì hợp lệ', () => {
    expect(validatePaymentQrDraft(BANK_OK)).toBeNull();
  });

  it('thiếu tên gọi thì chặn — người thu tiền phải biết mình đang chọn mã nào', () => {
    expect(validatePaymentQrDraft({ ...BANK_OK, label: '   ' })).toMatch(/đặt tên/);
  });

  it('BIN không phải 6 chữ số thì chặn', () => {
    expect(validatePaymentQrDraft({ ...BANK_OK, bank_bin: '97043' })).toMatch(/6 chữ số/);
    expect(validatePaymentQrDraft({ ...BANK_OK, bank_bin: '9704361' })).toMatch(/6 chữ số/);
    expect(validatePaymentQrDraft({ ...BANK_OK, bank_bin: 'VCB' })).toMatch(/6 chữ số/);
  });

  it('số tài khoản có CHỮ vẫn hợp lệ — có ngân hàng đánh số kiểu đó', () => {
    expect(validatePaymentQrDraft({ ...BANK_OK, account_no: 'VQRQ0123ABC' })).toBeNull();
  });

  it('thiếu tên chủ tài khoản thì chặn — khách cần thấy mình chuyển cho ai', () => {
    expect(validatePaymentQrDraft({ ...BANK_OK, account_name: '' })).toMatch(/chủ tài khoản/);
  });
});

describe('validatePaymentQrDraft — mã dạng ảnh', () => {
  it('có ảnh là đủ, KHÔNG đòi số tài khoản', () => {
    expect(
      validatePaymentQrDraft({
        kind: 'IMAGE',
        label: 'MoMo bố',
        image_url: '/uploads/payment-qr/abc.webp',
      }),
    ).toBeNull();
  });

  it('không có ảnh thì chặn', () => {
    expect(validatePaymentQrDraft({ kind: 'IMAGE', label: 'MoMo bố' })).toMatch(/tải lên/);
  });
});

describe('bảng mã ngân hàng', () => {
  it('mọi BIN đều đúng 6 chữ số và không trùng nhau', () => {
    const bins = VIETQR_BANKS.map((b) => b.bin);
    for (const bin of bins) expect(bin).toMatch(/^\d{6}$/);
    expect(new Set(bins).size).toBe(bins.length);
  });

  it('tra được tên ngân hàng từ BIN, BIN lạ thì trả null để nơi gọi dùng tên gõ tay', () => {
    expect(bankNameFromBin('970436')).toBe('Vietcombank');
    expect(bankNameFromBin('999999')).toBeNull();
    expect(bankNameFromBin(null)).toBeNull();
  });
});
