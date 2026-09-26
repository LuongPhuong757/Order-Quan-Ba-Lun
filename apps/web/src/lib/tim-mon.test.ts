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

  it('một khoảng trắng ở đầu HOẶC cuối đều là "nguyên từ" — ca dẫn tới luật này: "ốc " ra "ruốc"', () => {
    expect(khopTuKhoa('Mướp đắng ruốc', 'ốc ')).toBe(false);
    expect(khopTuKhoa('Mướp đắng ruốc', 'oc ')).toBe(false);
    expect(khopTuKhoa('Ốc hương', 'ốc ')).toBe(true);
    expect(khopTuKhoa('Bún ốc', 'ốc ')).toBe(true);
    expect(khopTuKhoa('Ốc hương xào', ' ốc')).toBe(true);
    expect(khopTuKhoa('Mướp đắng ruốc', 'ốc')).toBe(true); // không dấu cách: khớp giữa từ như cũ
    // "ga " cũng không còn ra "Ngải" — biên đầu được chặn dù dấu cách ở cuối.
    expect(khopTuKhoa('Ngải cứu', 'ga ')).toBe(false);
    // Cụm nhiều chữ vẫn là nguyên cụm: "chao chim " không ra "cháo chim non"? Có — "chim" là
    // nguyên từ; nhưng không ra "cháo chimchim".
    expect(khopTuKhoa('Lẩu cháo chim non', 'chao chim ')).toBe(true);
    expect(khopTuKhoa('Cháo chimchim', 'chao chim ')).toBe(false);
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

  it('gõ KHÔNG dấu thì bỏ dấu hai phía, không phân biệt hoa thường', () => {
    expect(khopTuKhoa('Gà nướng', 'GA ')).toBe(true);
    expect(khopTuKhoa('Đậu phụ', 'dau')).toBe(true);
    expect(khopTuKhoa('Cá kho', 'ca ')).toBe(true);
  });

  it('gõ CÓ dấu thì so giữ dấu — ca dẫn tới luật này: "gà" không được ra "ngải"', () => {
    expect(khopTuKhoa('Ngải cứu', 'ga')).toBe(true); // không dấu: vẫn khớp giữa từ như cũ
    expect(khopTuKhoa('Ngải cứu', 'gà')).toBe(false);
    expect(khopTuKhoa('Gà nướng', 'gà')).toBe(true);
    expect(khopTuKhoa('Gà nướng', 'GÀ ')).toBe(true);
    expect(khopTuKhoa('Lẩu gà', 'gà ')).toBe(true);
    // Chữ đ cũng là "dấu": gõ "đậu" thì "dâu tây" không lọt.
    expect(khopTuKhoa('Đậu phụ', 'đậu')).toBe(true);
    expect(khopTuKhoa('Dâu tây', 'đậu')).toBe(false);
    // Gõ dấu sai với tên thì không khớp — người dùng thấy ngay để sửa, thay vì được "giúp" âm thầm.
    expect(khopTuKhoa('Gà nướng', 'gá')).toBe(false);
  });

  it('bàn phím iPhone gõ dấu dạng tách rời vẫn khớp tên dạng gộp trong DB', () => {
    const tachRoi = 'ga\u0300'; // a + dấu huyền rời
    expect(khopTuKhoa('Gà nướng', tachRoi)).toBe(true);
    expect(khopTuKhoa('Ga\u0300 nướng', 'gà')).toBe(true);
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
