import { describe, expect, it } from 'vitest';
import { normalizeSepayPayload, parseVnTime } from './sepay-payload.js';

/** Payload chép từ tài liệu SePay, chỉ đổi nội dung cho giống đơn của quán. */
const incoming = {
  id: 92704,
  gateway: 'Vietcombank',
  transactionDate: '2024-07-02 11:08:33',
  accountNumber: '1017588888',
  code: null,
  content: 'BAN05 DH123456 LUONG THUY',
  transferType: 'in',
  transferAmount: 250000,
  accumulated: 105000000,
  referenceCode: 'FT24012345678',
};

describe('parseVnTime', () => {
  it('hiểu chuỗi không múi giờ là giờ Việt Nam, không theo giờ máy chạy', () => {
    // 11:08:33 +07 = 04:08:33 UTC. Nếu ai đó bỏ +07:00 đi, test này đỏ trên container UTC.
    expect(parseVnTime('2024-07-02 11:08:33')).toBe(Date.UTC(2024, 6, 2, 4, 8, 33));
  });

  it('chuỗi rác thì lùi về hiện tại chứ không vứt giao dịch', () => {
    const before = Date.now();
    const got = parseVnTime('không phải ngày');
    expect(got).toBeGreaterThanOrEqual(before);
  });
});

describe('normalizeSepayPayload', () => {
  it('chuẩn hoá giao dịch tiền vào', () => {
    const got = normalizeSepayPayload(incoming);
    expect(got).toMatchObject({
      gateway: 'sepay',
      gatewayTxnId: '92704',
      amount: 250000,
      content: 'BAN05 DH123456 LUONG THUY',
      accountNo: '1017588888',
    });
  });

  it('BỎ QUA tiền ra — ghi vào bảng tiền về là làm hỏng mọi phép cộng sau này', () => {
    expect(normalizeSepayPayload({ ...incoming, transferType: 'out' })).toBeNull();
  });

  it('bỏ qua payload không có id (không có gì để chống trùng)', () => {
    expect(normalizeSepayPayload({ ...incoming, id: null })).toBeNull();
  });

  it('bỏ qua số tiền không dương', () => {
    expect(normalizeSepayPayload({ ...incoming, transferAmount: 0 })).toBeNull();
    expect(normalizeSepayPayload({ ...incoming, transferAmount: -5000 })).toBeNull();
  });

  it('lùi về description khi content trống — tài khoản đi đường SMS hay bị cắt nội dung', () => {
    const got = normalizeSepayPayload({ ...incoming, content: '', description: 'CK DH654321' });
    expect(got?.content).toBe('CK DH654321');
  });

  it('không nổ với payload rác', () => {
    expect(normalizeSepayPayload(null)).toBeNull();
    expect(normalizeSepayPayload('chuỗi')).toBeNull();
    expect(normalizeSepayPayload({})).toBeNull();
  });

  it('giữ nguyên payload gốc trong raw để còn đối chiếu khi hai bên lệch nhau', () => {
    expect(normalizeSepayPayload(incoming)?.raw).toBe(incoming);
  });
});
