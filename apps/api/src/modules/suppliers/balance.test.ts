// Công nợ NCC. Luật đổi 2026-09-07: cộng MỌI phiếu, trừ MỌI lần trả — xem docblock `balance.ts`.
import { describe, expect, it } from 'vitest';
import { computeBalance } from './balance.js';

describe('computeBalance — số dư đầu kỳ + Σ phiếu − Σ đã trả', () => {
  it('cộng phiếu, trừ thanh toán', () => {
    const b = computeBalance({
      opening_balance: 4_000_000,
      opening_balance_date: '2026-08-01',
      deliveries: [{ date: '2026-08-10', amount: 6_000_000 }],
      payments: [{ date: '2026-08-20', amount: 3_000_000 }],
    });
    expect(b.purchased).toBe(6_000_000);
    expect(b.paid).toBe(3_000_000);
    expect(b.balance).toBe(7_000_000);
  });

  // Đây là hình dạng ĐÚNG của sự cố production 2026-09-07: mốc số dư đầu kỳ là ngày tạo NCC
  // (hôm nay), còn 12 phiếu nhập bù đều mang ngày của mấy tuần trước. Luật cũ bỏ hết chúng và
  // "đã mua" hiện 0đ.
  it('phiếu TRƯỚC mốc số dư đầu kỳ vẫn được cộng', () => {
    const b = computeBalance({
      opening_balance: 61_307_000,
      opening_balance_date: '2026-09-07',
      deliveries: [
        { date: '2026-08-24', amount: 2_716_000 },
        { date: '2026-08-25', amount: 2_220_000 },
        { date: '2026-09-05', amount: 17_264_500 },
      ],
      payments: [],
    });
    expect(b.purchased).toBe(22_200_500);
    expect(b.balance).toBe(83_507_500);
  });

  it('thanh toán TRƯỚC mốc số dư đầu kỳ vẫn được trừ', () => {
    const b = computeBalance({
      opening_balance: 10_000_000,
      opening_balance_date: '2026-09-07',
      deliveries: [],
      payments: [{ date: '2026-08-30', amount: 4_000_000 }],
    });
    expect(b.paid).toBe(4_000_000);
    expect(b.balance).toBe(6_000_000);
  });

  it('mốc chỉ còn là THÔNG TIN, đổi mốc không đổi con số', () => {
    const input = {
      opening_balance: 5_000_000,
      deliveries: [{ date: '2026-06-01', amount: 1_000_000 }],
      payments: [{ date: '2026-07-01', amount: 400_000 }],
    };
    const som = computeBalance({ ...input, opening_balance_date: '2026-01-01' });
    const muon = computeBalance({ ...input, opening_balance_date: '2026-12-31' });
    const chua = computeBalance({ ...input, opening_balance_date: null });
    expect(som.balance).toBe(5_600_000);
    expect(muon.balance).toBe(5_600_000);
    expect(chua.balance).toBe(5_600_000);
    expect(chua.opening_balance_date).toBeNull();
  });

  it('chưa khai số dư đầu kỳ: con số là phát sinh từ đầu lịch sử, không phải nợ thật', () => {
    // Q-7 trong spec. Vẫn dùng được, nhưng màn hình phải nói rõ — `opening_balance_date` null
    // là thứ để nói câu đó.
    const b = computeBalance({
      opening_balance: 0,
      opening_balance_date: null,
      deliveries: [{ date: '2026-08-10', amount: 6_000_000 }],
      payments: [],
    });
    expect(b.balance).toBe(6_000_000);
    expect(b.opening_balance_date).toBeNull();
  });

  it('trả dư ra số âm chứ không kẹp về 0', () => {
    // Trả trước cho NCC là chuyện có thật ở quán ăn. Kẹp về 0 sẽ giấu mất khoản quán đang ứng
    // trước, và lần đối chiếu sau không ai hiểu vì sao lệch.
    const b = computeBalance({
      opening_balance: 0,
      opening_balance_date: null,
      deliveries: [{ date: '2026-08-10', amount: 1_000_000 }],
      payments: [{ date: '2026-08-11', amount: 1_500_000 }],
    });
    expect(b.balance).toBe(-500_000);
  });

  it('không có gì cả thì bằng 0, không phải NaN', () => {
    const b = computeBalance({
      opening_balance: 0,
      opening_balance_date: null,
      deliveries: [],
      payments: [],
    });
    expect(b.balance).toBe(0);
  });
});
