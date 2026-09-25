// Mã đơn trong nội dung chuyển khoản. Thuần, nên test được không cần MySQL lẫn ngân hàng.
//
// Những ca dưới đây KHÔNG phải tình huống giả định cho đủ bộ: nội dung CK về tay ta đã qua tay
// khách (sửa được), qua app ngân hàng của khách (chèn chữ), rồi qua ngân hàng nhận (bọc kín). Mỗi
// ca là một kiểu bóp méo có thật, và bóc sai thì hậu quả là đánh dấu "đã trả tiền" cho đơn của
// người khác — sai lặng lẽ, không ai phát hiện cho tới lúc đếm két.
import { describe, expect, it } from 'vitest';
import {
  PAYMENT_CODE_ALPHABET,
  TRANSFER_NOTE_MAX,
  buildPaymentCode,
  buildTransferNote,
  extractPaymentCode,
  isValidPaymentCode,
  paymentNote,
  suggestedNotePrefix,
} from '@order/schemas';

describe('buildPaymentCode', () => {
  it('ghép nhóm + số bàn + chữ cái', () => {
    expect(buildPaymentCode('BAN', 5, 'ABC')).toBe('BAN05ABC');
    expect(buildPaymentCode('BAN', 12, 'XYZ')).toBe('BAN12XYZ');
  });

  it('bàn không có số và đơn online đều dùng 00 — chuỗi phải giữ đúng một hình dạng', () => {
    expect(buildPaymentCode('BAN', null, 'ABC')).toBe('BAN00ABC');
    expect(buildPaymentCode('DON', 0, 'ABC')).toBe('DON00ABC');
  });

  it('ném khi chữ cái sai khuôn — thà chết ở chỗ sinh mã còn hơn in ra QR không khớp lại được', () => {
    expect(() => buildPaymentCode('BAN', 5, 'AB')).toThrow();
    expect(() => buildPaymentCode('BAN', 5, 'A1C')).toThrow();
  });

  it('bảng chữ cái bỏ I và O — hai chữ lẫn với 1 và 0 ngay cạnh hai chữ số của mã bàn', () => {
    expect(PAYMENT_CODE_ALPHABET).not.toContain('I');
    expect(PAYMENT_CODE_ALPHABET).not.toContain('O');
  });
});

describe('extractPaymentCode', () => {
  it('bóc được mã trần', () => {
    expect(extractPaymentCode('BAN05ABC')).toBe('BAN05ABC');
  });

  it('bóc được từ chuỗi ngân hàng bọc kín — chuỗi THẬT gặp hôm 2026-09-22', () => {
    const real =
      'CT DEN:106T2691148BUT55 MBVCB.16177901321.548513.SEVQR BAN02ABC.CT tu 0901000137182 LUONG TUAN PHUONG toi 101888309570';
    expect(extractPaymentCode(real)).toBe('BAN02ABC');
  });

  it('không phân biệt hoa thường — một số ngân hàng viết hoa toàn bộ', () => {
    expect(extractPaymentCode('chuyen tien ban05abc')).toBe('BAN05ABC');
  });

  it('bóc được mã đơn online', () => {
    expect(extractPaymentCode('SEVQR DON00XYZ')).toBe('DON00XYZ');
  });

  it('KHÔNG nhận chữ dính liền phía trước', () => {
    // "VIETINBANK01ABC" mà nhận là mọi chữ "BANK"/"NGAN HANG" trong nội dung ngân hàng đều
    // thành ứng viên.
    expect(extractPaymentCode('VIETINBAN01ABC')).toBeNull();
    expect(extractPaymentCode('9BAN01ABC')).toBeNull();
  });

  it('KHÔNG cắt lấy 8 ký tự đầu của chuỗi dài hơn', () => {
    expect(extractPaymentCode('BAN01ABCD')).toBeNull();
    expect(extractPaymentCode('BAN01ABC9')).toBeNull();
  });

  it('chữ BANK không bị nhận nhầm', () => {
    expect(extractPaymentCode('CHUYEN KHOAN VIETINBANK')).toBeNull();
  });

  it('trả null khi khách xoá sạch nội dung', () => {
    expect(extractPaymentCode('tra tien')).toBeNull();
    expect(extractPaymentCode('')).toBeNull();
  });
});

describe('isValidPaymentCode', () => {
  it('chỉ nhận đúng khuôn nhóm + 2 số + 3 chữ', () => {
    expect(isValidPaymentCode('BAN05ABC')).toBe(true);
    expect(isValidPaymentCode('DON00XYZ')).toBe(true);
    expect(isValidPaymentCode('BAN5ABC')).toBe(false);
    expect(isValidPaymentCode('BAN05AB')).toBe(false);
    expect(isValidPaymentCode('XXX05ABC')).toBe(false);
  });
});

describe('buildTransferNote', () => {
  const table = { code: 'B05', name: 'Bàn 5' };

  it('mã đứng đầu, rồi tới tên người thu — KHÔNG lặp lại mã bàn (mã đã mang sẵn)', () => {
    const note = buildTransferNote(table, { full_name: 'Lương Thị Thuý' }, 'BAN05ABC');
    expect(note).toBe('BAN05ABC LUONG THUY');
    expect(note.length).toBeLessThanOrEqual(TRANSFER_NOTE_MAX);
  });

  it('có tiền tố ngân hàng thì vẫn vừa 25 ký tự với tên thường gặp', () => {
    const note = buildTransferNote(table, { full_name: 'Lương Thị Thuý' }, 'BAN05ABC', 'SEVQR');
    expect(note).toBe('SEVQR BAN05ABC LUONG THUY');
    expect(note.length).toBe(TRANSFER_NOTE_MAX);
  });

  it('tên rất dài thì CẮT TÊN, mã còn nguyên', () => {
    const note = buildTransferNote(
      table,
      { full_name: 'Nguyễn Trần Hoàng Minh Nguyệt' },
      'BAN05ABC',
      'SEVQR',
    );
    expect(note.length).toBeLessThanOrEqual(TRANSFER_NOTE_MAX);
    expect(extractPaymentCode(note)).toBe('BAN05ABC');
  });

  it('không truyền mã thì giữ nguyên hành vi cũ', () => {
    // Đơn thu tay trước tính năng này phải dựng lại được nội dung y hệt lúc in ra.
    expect(buildTransferNote(table, { full_name: 'Lương Thị Thuý' })).toBe('BAN05 LUONG THUY');
  });
});

describe('tiền tố bắt buộc của ngân hàng', () => {
  it('VietinBank đòi SEVQR', () => {
    // Không phải quy ước của quán: tài liệu SePay ghi rõ mọi giao dịch VietinBank cá nhân phải
    // bắt đầu bằng SEVQR, nếu không họ KHÔNG nhận được biến động số dư.
    expect(suggestedNotePrefix('970415')).toBe('SEVQR');
  });

  it('ngân hàng khác không đòi gì', () => {
    expect(suggestedNotePrefix('970436')).toBeNull(); // Vietcombank
    expect(suggestedNotePrefix(null)).toBeNull();
  });

  it('ba tài khoản mở thêm 2026-09-23 mặc định KHÔNG có tiền tố', () => {
    // Chốt lại hiện trạng để lần sau ai đó điền tiền tố cho một trong ba ngân hàng này thì test
    // đỏ lên và buộc họ nói rõ vì sao — tiền tố sai cũng làm cổng mù y như thiếu tiền tố.
    // Đổi ở đây là phải đổi cả `docs/DOI-SOAT-SEPAY.md`.
    expect(suggestedNotePrefix('970423')).toBeNull(); // TPBank
    expect(suggestedNotePrefix('970436')).toBeNull(); // Vietcombank (kể cả hộ kinh doanh/OneQR)
    expect(suggestedNotePrefix('970422')).toBeNull(); // MB Bank
  });

  it('BIN lạ không làm hàm nổ', () => {
    // Chủ quán gõ tay được BIN ở ô "Ngân hàng khác", nên hàm phải nuốt được mọi chuỗi.
    expect(suggestedNotePrefix('999999')).toBeNull();
    expect(suggestedNotePrefix('')).toBeNull();
    expect(suggestedNotePrefix('constructor')).toBeNull();
  });

  it('paymentNote đặt tiền tố ở ĐẦU — ngân hàng kiểm "bắt đầu bằng", không phải "có chứa"', () => {
    expect(paymentNote('BAN05ABC', 'SEVQR')).toBe('SEVQR BAN05ABC');
    expect(paymentNote('BAN05ABC')).toBe('BAN05ABC');
    expect(extractPaymentCode(paymentNote('BAN05ABC', 'SEVQR'))).toBe('BAN05ABC');
  });
});
