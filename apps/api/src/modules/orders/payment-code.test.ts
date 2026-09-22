// Mã đơn trong nội dung chuyển khoản. Thuần, nên test được không cần MySQL lẫn ngân hàng.
//
// Những ca dưới đây KHÔNG phải tình huống giả định cho đủ bộ: nội dung CK về tay ta đã qua tay
// khách (sửa được), qua app ngân hàng của khách (chèn chữ), rồi qua SePay (viết hoa). Mỗi ca là
// một kiểu bóp méo có thật, và bóc sai thì hậu quả là đánh dấu "đã trả tiền" cho đơn của người
// khác — sai lặng lẽ, không ai phát hiện ra cho tới lúc đếm két.
import { describe, expect, it } from 'vitest';
import {
  PAYMENT_CODE_NOTE_LENGTH,
  TRANSFER_NOTE_MAX,
  buildTransferNote,
  extractPaymentCode,
  isValidPaymentCode,
  paymentNote,
} from '@order/schemas';

describe('extractPaymentCode', () => {
  it('bóc được mã trần', () => {
    expect(extractPaymentCode('DH123456')).toBe('123456');
  });

  it('bóc được khi ngân hàng bọc thêm chữ quanh mã', () => {
    expect(extractPaymentCode('CHUYEN TIEN DH123456 NGUYEN VAN A')).toBe('123456');
  });

  it('không phân biệt hoa thường — một số ngân hàng viết hoa toàn bộ, số khác giữ nguyên', () => {
    expect(extractPaymentCode('chuyen tien dh123456')).toBe('123456');
  });

  it('chịu được khoảng trắng app ngân hàng chèn vào giữa tiền tố và số', () => {
    expect(extractPaymentCode('DH 123456 TT')).toBe('123456');
  });

  it('KHÔNG nhận chuỗi rác chỉ trùng đuôi', () => {
    // "ABCDH123456" không phải mã của ta. Nhận bừa là khớp tiền sang một đơn ngẫu nhiên.
    expect(extractPaymentCode('ABCDH123456')).toBeNull();
    expect(extractPaymentCode('9DH123456')).toBeNull();
  });

  it('KHÔNG cắt 6 số đầu của một dãy dài hơn', () => {
    // "DH1234567" mà nhận thành 123456 là khớp nhầm sang đơn khác — đúng loại sai không cứu được.
    expect(extractPaymentCode('DH1234567')).toBeNull();
  });

  it('trả null khi khách xoá sạch nội dung', () => {
    expect(extractPaymentCode('tra tien')).toBeNull();
    expect(extractPaymentCode('')).toBeNull();
  });
});

describe('paymentNote', () => {
  it('ghép đúng khuôn', () => {
    expect(paymentNote('123456')).toBe('DH123456');
    expect(paymentNote('000001')).toBe('DH000001');
  });

  it('ném khi mã sai khuôn — thà chết ở chỗ sinh mã còn hơn in ra QR không khớp lại được', () => {
    expect(() => paymentNote('12345')).toThrow();
    expect(() => paymentNote('abcdef')).toThrow();
  });

  it('bóc lại được đúng thứ vừa ghép ra', () => {
    expect(extractPaymentCode(paymentNote('907001'))).toBe('907001');
  });

  it('PAYMENT_CODE_NOTE_LENGTH khớp độ dài thật', () => {
    expect(paymentNote('123456')).toHaveLength(PAYMENT_CODE_NOTE_LENGTH);
  });
});

describe('isValidPaymentCode', () => {
  it('chỉ nhận đúng 6 chữ số', () => {
    expect(isValidPaymentCode('123456')).toBe(true);
    expect(isValidPaymentCode('12345')).toBe(false);
    expect(isValidPaymentCode('1234567')).toBe(false);
    expect(isValidPaymentCode('12345a')).toBe(false);
  });
});

describe('buildTransferNote kèm mã đơn', () => {
  const table = { code: 'B05', name: 'Bàn 5' };

  it('mã đứng ngay sau mã bàn, trước tên người thu', () => {
    const note = buildTransferNote(table, { full_name: 'Lương Thị Thuý' }, '123456');
    expect(note).toBe('BAN05 DH123456 LUONG THUY');
    expect(note.length).toBeLessThanOrEqual(TRANSFER_NOTE_MAX);
  });

  it('tên dài thì CẮT TÊN, mã đơn còn nguyên', () => {
    // Đây là bất biến quan trọng nhất của hàm này: mã mất là đối soát tự động mù hẳn,
    // còn tên mất thì vẫn tra ra được từ `checked_out_by_full_name` của đơn.
    const note = buildTransferNote(table, { full_name: 'Nguyễn Trần Hoàng Minh Nguyệt' }, '987654');
    expect(note.length).toBeLessThanOrEqual(TRANSFER_NOTE_MAX);
    expect(extractPaymentCode(note)).toBe('987654');
    expect(note.startsWith('BAN05 DH987654')).toBe(true);
  });

  it('không truyền mã thì giữ nguyên hành vi cũ', () => {
    // Đơn thu tay trước tính năng này phải dựng lại được nội dung y hệt lúc in ra.
    expect(buildTransferNote(table, { full_name: 'Lương Thị Thuý' })).toBe('BAN05 LUONG THUY');
  });
});
