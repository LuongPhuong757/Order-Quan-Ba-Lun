import { describe, expect, it } from 'vitest';
import { moneyPart, moneyPortion } from './payment-portion.js';

describe('moneyPortion — bộ lọc hỏi về phần tiền nào', () => {
  it('không lọc gì / lọc "Cả hai" → trọn đơn', () => {
    expect(moneyPortion({})).toBe('all');
    expect(moneyPortion({ payment: 'mixed' })).toBe('all');
  });

  it('tài khoản nhận, CK, xác nhận NH, ảnh bill → phần chuyển khoản', () => {
    expect(moneyPortion({ qr_account_id: 'acc-a' })).toBe('transfer');
    expect(moneyPortion({ payment: 'transfer' })).toBe('transfer');
    expect(moneyPortion({ verified: 'no' })).toBe('transfer');
    expect(moneyPortion({ photo: 'has' })).toBe('transfer');
    expect(moneyPortion({ payment: 'mixed', qr_account_id: 'acc-a' })).toBe('transfer');
  });

  it('"Tiền mặt" thắng cả khi chọn cùng tài khoản A', () => {
    expect(moneyPortion({ payment: 'cash' })).toBe('cash');
    expect(moneyPortion({ payment: 'cash', qr_account_id: 'acc-a' })).toBe('cash');
  });
});

describe('moneyPart — tách tiền một đơn', () => {
  it('đơn Cả hai 100k, CK 30k: phần CK 30k, tiền mặt 70k', () => {
    expect(moneyPart('transfer', 100_000, 100_000, 30_000)).toBe(30_000);
    expect(moneyPart('cash', 100_000, 100_000, 30_000)).toBe(70_000);
    expect(moneyPart('all', 100_000, 100_000, 30_000)).toBe(100_000);
  });

  it('tiền món và ship chia theo tỉ lệ CK / tổng thu', () => {
    // 80k món + 20k ship = 100k, CK 50k → một nửa mỗi mảnh.
    expect(moneyPart('transfer', 80_000, 100_000, 50_000)).toBe(40_000);
    expect(moneyPart('cash', 80_000, 100_000, 50_000)).toBe(40_000);
    expect(moneyPart('transfer', 20_000, 100_000, 50_000)).toBe(10_000);
  });

  it('hai phần luôn cộng lại đúng số gốc, kể cả khi phải làm tròn', () => {
    const amount = 33_333;
    const t = moneyPart('transfer', amount, 100_001, 12_345);
    const c = moneyPart('cash', amount, 100_001, 12_345);
    expect(t + c).toBe(amount);
  });

  it('đơn tiền mặt / CK trọn đơn', () => {
    expect(moneyPart('transfer', 50_000, 50_000, 0)).toBe(0);
    expect(moneyPart('cash', 50_000, 50_000, 0)).toBe(50_000);
    expect(moneyPart('transfer', 50_000, 50_000, 50_000)).toBe(50_000);
    expect(moneyPart('cash', 50_000, 50_000, 50_000)).toBe(0);
  });

  it('CK vượt tổng (sửa bớt món sau khi thu) → kẹp về tổng, tiền mặt không âm', () => {
    expect(moneyPart('transfer', 40_000, 40_000, 55_000)).toBe(40_000);
    expect(moneyPart('cash', 40_000, 40_000, 55_000)).toBe(0);
  });

  it('đơn tổng 0đ không chia cho 0', () => {
    expect(moneyPart('transfer', 0, 0, 0)).toBe(0);
    expect(moneyPart('cash', 0, 0, 0)).toBe(0);
  });
});
