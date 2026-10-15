import { describe, expect, it } from 'vitest';
import { orderStateOf, rankCandidates, reviewReasonOf } from './bank-ledger-link.js';

describe('orderStateOf', () => {
  const base = { closed_at: 1, is_paid: true, transfer_amount: 300_000, debt_at: null };

  it('bàn chưa đóng là "open" — ca tiền về mà chưa bấm thanh toán', () => {
    expect(orderStateOf({ ...base, closed_at: null, is_paid: false })).toBe('open');
  });
  it('đã thu có phần chuyển khoản là "paid"', () => {
    expect(orderStateOf(base)).toBe('paid');
  });
  it('đã thu nhưng ghi tiền mặt là "cash" — người thu chọn nhầm hình thức', () => {
    expect(orderStateOf({ ...base, transfer_amount: 0 })).toBe('cash');
  });
  it('đóng chưa thu có mốc nợ là "debt", không mốc nợ là "cancelled"', () => {
    expect(orderStateOf({ ...base, is_paid: false, debt_at: 5 })).toBe('debt');
    expect(orderStateOf({ ...base, is_paid: false })).toBe('cancelled');
  });
});

describe('reviewReasonOf', () => {
  const ok = { needs_review: true, amount: 300_000, received_amount: 300_000, expected_account_no: '111' };

  it('không gắn cờ thì không có lý do', () => {
    expect(reviewReasonOf({ ...ok, needs_review: false, received_amount: 1 }, '111')).toBeNull();
  });
  it('thiếu tiền đứng trước sai tài khoản', () => {
    expect(reviewReasonOf({ ...ok, received_amount: 200_000 }, '222')).toBe('thieu');
  });
  it('đủ tiền nhưng về tài khoản khác QR đã chìa', () => {
    expect(reviewReasonOf(ok, '222')).toBe('sai_tk');
  });
  it('thiếu một trong hai số tài khoản thì không buộc tội sai tài khoản', () => {
    expect(reviewReasonOf({ ...ok, received_amount: 400_000, expected_account_no: null }, '222')).toBe('thua');
  });
});

describe('rankCandidates', () => {
  it('đúng số tiền lên đầu, rồi tới đơn đóng gần giờ tiền về', () => {
    const at = 1_000_000;
    const rows = [
      { id: 'xa-dung-tien', closed_at: at - 5000, transfer_amount: 250_000 },
      { id: 'gan-lech-tien', closed_at: at - 10, transfer_amount: 260_000 },
      { id: 'gan-dung-tien', closed_at: at + 100, transfer_amount: 250_000 },
    ];
    expect(rankCandidates(rows, 250_000, at).map((r) => r.id)).toEqual([
      'gan-dung-tien',
      'xa-dung-tien',
      'gan-lech-tien',
    ]);
  });
  it('không sửa mảng gốc', () => {
    const rows = [
      { id: 'b', closed_at: 9, transfer_amount: 1 },
      { id: 'a', closed_at: 1, transfer_amount: 1 },
    ];
    rankCandidates(rows, 1, 0);
    expect(rows[0].id).toBe('b');
  });
});
