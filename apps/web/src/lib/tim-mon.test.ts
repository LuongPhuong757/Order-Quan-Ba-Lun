import { describe, expect, it } from 'vitest';
import { khopTuKhoa } from './tim-mon.ts';

describe('khopTuKhoa', () => {
  it('khoảng trắng cuối loại được món khớp giữa từ — ca dẫn tới hàm này', () => {
    // Chủ quán gõ "ga " để tìm món gà, và "Ngao" không được nhảy vào nữa.
    expect(khopTuKhoa('Gà nướng', 'ga ')).toBe(true);
    expect(khopTuKhoa('Ngao hấp', 'ga ')).toBe(false);
  });

  it('tên KẾT THÚC bằng từ khoá vẫn khớp — nhờ đệm khoảng trắng hai đầu', () => {
    // Thiếu phần đệm thì "lau ga" không có khoảng trắng nào sau chữ "ga" và món này biến mất,
    // đúng món người dùng đang tìm.
    expect(khopTuKhoa('Lẩu gà', 'ga ')).toBe(true);
    expect(khopTuKhoa('Lẩu gà', ' ga')).toBe(true);
    expect(khopTuKhoa('Lẩu gà', ' ga ')).toBe(true);
  });

  it('khoảng trắng ĐẦU loại được món có từ khoá nằm cuối một chữ', () => {
    expect(khopTuKhoa('Gà nướng', ' ga')).toBe(true);
    expect(khopTuKhoa('Ngao hấp', ' ga')).toBe(false);
    // "cua" nằm cuối chữ "lươn cua"? Không — ví dụ thật: "ca" trong "ốc" thì không, dùng "ba".
    expect(khopTuKhoa('Cua rang me', ' cua')).toBe(true);
    expect(khopTuKhoa('Ốc hương', ' cua')).toBe(false);
  });

  it('không gõ khoảng trắng thì khớp giữa từ như cũ', () => {
    expect(khopTuKhoa('Ngao hấp', 'ga')).toBe(true);
    expect(khopTuKhoa('Bạch tuộc', 'tuo')).toBe(true);
  });

  it('bỏ dấu và không phân biệt hoa thường', () => {
    expect(khopTuKhoa('Gà nướng', 'GÀ ')).toBe(true);
    expect(khopTuKhoa('Đậu phụ', 'dau')).toBe(true);
    expect(khopTuKhoa('Cá kho', 'ca ')).toBe(true);
  });

  it('khớp được cụm nhiều chữ', () => {
    expect(khopTuKhoa('Lẩu cháo chim', 'chao chim')).toBe(true);
    expect(khopTuKhoa('Lẩu cháo chim', 'chim chao')).toBe(false);
  });

  it('tên có hai dấu cách liền vẫn khớp bình thường', () => {
    expect(khopTuKhoa('Lẩu  gà  ta', 'ga ')).toBe(true);
    expect(khopTuKhoa('Lẩu  gà  ta', 'lau ga')).toBe(true);
  });

  it('từ khoá rỗng hoặc chỉ khoảng trắng thì khớp tất cả', () => {
    expect(khopTuKhoa('Bất kỳ món nào', '')).toBe(true);
    expect(khopTuKhoa('Bất kỳ món nào', '   ')).toBe(true);
  });
});
