// Nội dung chuyển khoản + chuỗi VietQR. Cả hai đều thuần nên test được không cần MySQL lẫn
// trình duyệt — mà chúng lại là hai thứ KHÔNG THỂ kiểm bằng mắt: một chuỗi EMVCo sai vẫn vẽ ra
// hình vuông đẹp đẽ, chỉ app ngân hàng của khách mới nói "mã không hợp lệ", đúng lúc không ai
// muốn nghe điều đó.
import { describe, expect, it } from 'vitest';
import {
  TRANSFER_NOTE_MAX,
  buildTransferNote,
  buildVietQrPayload,
  cashierTag,
  crc16ccitt,
  parseTlv,
  tableTag,
  toAsciiUpper,
} from '@order/schemas';

describe('bỏ dấu tiếng Việt', () => {
  it('giữ được chữ Đ — thứ mà normalize(NFD) làm mất', () => {
    // "Đặng" qua NFD rồi lọc ký tự lạ sẽ thành "ng": mất luôn chữ cái đầu của họ.
    expect(toAsciiUpper('Đặng Thị Ưng')).toBe('DANG THI UNG');
  });

  it('bỏ ký tự lạ và gom khoảng trắng', () => {
    expect(toAsciiUpper('  Lương  Thị (Thuý)  ')).toBe('LUONG THI THUY');
  });
});

describe('mã bàn', () => {
  it('hai lối đặt mã đang cùng tồn tại trong DB đều ra một dạng', () => {
    expect(tableTag('B05', 'Bàn 5')).toBe('BAN05');
    expect(tableTag('ban-01', 'Bàn 01')).toBe('BAN01');
  });

  it('bàn không có số thì lấy tên — quán vẫn thu tiền ở bàn "Mang về"', () => {
    expect(tableTag('mang-ve', 'Mang về')).toBe('MANG VE');
  });
});

describe('tên người thu — HỌ + TÊN (chủ quán chốt 2026-09-14)', () => {
  it('lấy họ và tên, bỏ chữ đệm', () => {
    expect(cashierTag('Lương Thị Thuý')).toBe('LUONG THUY');
    expect(cashierTag('Nguyễn Văn An')).toBe('NGUYEN AN');
  });

  it('tên một chữ thì giữ nguyên', () => {
    expect(cashierTag('Thuý')).toBe('THUY');
  });

  it('full_name NULL thì lùi về username — trong DB thật có tài khoản như vậy', () => {
    expect(cashierTag(null, 'zz-admin-luong')).toBe('ZZ ADMIN LUONG');
    expect(cashierTag(null, null)).toBe('NV');
  });
});

describe('ghép nội dung chuyển khoản', () => {
  it('dạng chuẩn', () => {
    expect(buildTransferNote({ code: 'B05', name: 'Bàn 5' }, { full_name: 'Lương Thị Thuý' })).toBe(
      'BAN05 LUONG THUY',
    );
  });

  it('không bao giờ vượt trần 25 ký tự của trường 62.08', () => {
    const note = buildTransferNote(
      { code: 'B12', name: 'Bàn 12' },
      { full_name: 'Nguyễn Thị Hoàng Phương Thảo' },
    );
    expect(note.length).toBeLessThanOrEqual(TRANSFER_NOTE_MAX);
    // Cắt thì hy sinh tên người thu, mã bàn phải còn nguyên — nó mới là thứ định vị được đơn.
    expect(note.startsWith('BAN12')).toBe(true);
  });
});

describe('CRC-16/CCITT-FALSE', () => {
  it('khớp vector kiểm chuẩn của thuật toán: "123456789" → 29B1', () => {
    expect(crc16ccitt('123456789')).toBe('29B1');
  });
});

describe('chuỗi VietQR', () => {
  const payload = buildVietQrPayload({
    bankBin: '970436',
    accountNo: '0123456789',
    amount: 250000,
    note: 'BAN05 LUONG THUY',
  });

  it('CRC ở cuối phải tính trên chuỗi ĐÃ gồm "6304" — chỗ sai kinh điển của chuẩn này', () => {
    const body = payload.slice(0, -4);
    expect(body.endsWith('6304')).toBe(true);
    expect(payload.slice(-4)).toBe(crc16ccitt(body));
  });

  it('mang đủ ngân hàng, số tài khoản, số tiền và nội dung', () => {
    const top = parseTlv(payload);
    expect(top['53']).toBe('704'); // VND
    expect(top['58']).toBe('VN');
    expect(top['54']).toBe('250000');

    const merchant = parseTlv(top['38']);
    expect(merchant['00']).toBe('A000000727'); // Napas
    expect(merchant['02']).toBe('QRIBFTTA'); // chuyển tới tài khoản, không phải tới thẻ

    const beneficiary = parseTlv(merchant['01']);
    expect(beneficiary['00']).toBe('970436');
    expect(beneficiary['01']).toBe('0123456789');

    expect(parseTlv(top['62'])['08']).toBe('BAN05 LUONG THUY');
  });

  it('số tiền 0 thì KHÔNG có trường 54 — QR để khách tự gõ số', () => {
    const p = buildVietQrPayload({ bankBin: '970436', accountNo: '1', amount: 0 });
    expect(parseTlv(p)['54']).toBeUndefined();
  });

  it('số lẻ được làm tròn — một dấu chấm thừa là QR hỏng', () => {
    const p = buildVietQrPayload({ bankBin: '970436', accountNo: '1', amount: 1000.6 });
    expect(parseTlv(p)['54']).toBe('1001');
  });

  it('BIN sai thì ném ngay, không đẻ ra mã chết', () => {
    expect(() => buildVietQrPayload({ bankBin: '97043', accountNo: '1' })).toThrow(/BIN/);
  });
});
