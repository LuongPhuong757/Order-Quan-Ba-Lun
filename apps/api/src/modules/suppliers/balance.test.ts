// Test THUẦN, không cần MySQL.
import { describe, expect, it } from 'vitest';
import { computeBalance, countsToward, sumAfter } from './balance.js';

describe('sumAfter — chặn tính hai lần quanh mốc số dư đầu kỳ', () => {
  const rows = [
    { date: '2026-07-15', amount: 5_000_000 }, // trước mốc — đã nằm trong opening_balance
    { date: '2026-08-01', amount: 3_000_000 }, // đúng ngày mốc
    { date: '2026-08-20', amount: 2_000_000 }, // sau mốc
  ];

  it('bỏ dòng TRƯỚC mốc, giữ dòng ĐÚNG NGÀY mốc', () => {
    // Đây là cái bẫy chính: phiếu 5 triệu hồi tháng 7 đã được chủ quán tính vào số dư đầu kỳ
    // rồi. Cộng lại lần nữa là nợ phồng lên 5 triệu mà không ai biết vì sao.
    expect(sumAfter(rows, '2026-08-01')).toBe(5_000_000);
  });

  it('không có mốc thì cộng tất cả', () => {
    expect(sumAfter(rows, null)).toBe(10_000_000);
  });

  it('mốc sau mọi dòng thì không cộng gì', () => {
    expect(sumAfter(rows, '2026-12-31')).toBe(0);
  });
});

describe('countsToward — cùng một điều kiện cho phép cộng và cho danh sách chi tiết', () => {
  // Màn "con số này ở đâu ra" lọc bằng hàm này, `sumAfter` cộng bằng chính nó. Hai bên lệch nhau
  // thì tổng hiện ra không khớp danh sách ngay bên dưới, và người đọc kết luận hệ thống tính sai.
  it('tổng của các dòng ĐƯỢC ĐẾM luôn bằng sumAfter', () => {
    const rows = [
      { date: '2026-07-01', amount: 1_000 },
      { date: '2026-08-01', amount: 2_000 },
      { date: '2026-09-01', amount: 3_000 },
    ];
    for (const cutoff of [null, '2026-06-01', '2026-08-01', '2026-08-15', '2026-12-31']) {
      const listed = rows.filter((r) => countsToward(r.date, cutoff));
      expect(listed.reduce((s, r) => s + r.amount, 0)).toBe(sumAfter(rows, cutoff));
    }
  });
});

describe('computeBalance', () => {
  it('số dư đầu kỳ + đã mua − đã trả', () => {
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

  it('phiếu và thanh toán trước mốc KHÔNG được tính lại', () => {
    const b = computeBalance({
      opening_balance: 4_000_000,
      opening_balance_date: '2026-08-01',
      deliveries: [
        { date: '2026-06-01', amount: 99_000_000 }, // lịch sử cũ, đã gộp vào số dư đầu kỳ
        { date: '2026-08-10', amount: 6_000_000 },
      ],
      payments: [
        { date: '2026-06-05', amount: 99_000_000 },
        { date: '2026-08-20', amount: 3_000_000 },
      ],
    });
    expect(b.balance).toBe(7_000_000);
  });

  it('chưa khai số dư đầu kỳ: con số là phát sinh từ đầu lịch sử, không phải nợ thật', () => {
    // Q-7 trong spec. Vẫn dùng được, nhưng màn hình phải nói rõ nó tính từ đâu — `counted_from`
    // là thứ để nói câu đó.
    const b = computeBalance({
      opening_balance: 0,
      opening_balance_date: null,
      deliveries: [{ date: '2026-08-10', amount: 6_000_000 }],
      payments: [],
    });
    expect(b.balance).toBe(6_000_000);
    expect(b.counted_from).toBeNull();
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

  it('không có giao dịch nào thì còn đúng số dư đầu kỳ', () => {
    const b = computeBalance({
      opening_balance: 4_000_000,
      opening_balance_date: '2026-08-01',
      deliveries: [],
      payments: [],
    });
    expect(b.balance).toBe(4_000_000);
  });
});
