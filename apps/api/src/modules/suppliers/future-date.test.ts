import { describe, it, expect } from 'vitest';
import { isFutureDate, assertNotFutureDate, todayVn } from './future-date.js';

const HOM_NAY = '2026-10-02';

const PHIEU = {
  code: 'DELIVERY_DATE_FUTURE',
  nhan: 'Ngày giao',
  viSao: 'Phiếu nhập chỉ ghi hàng ĐÃ về.',
};
const TRA_TIEN = {
  code: 'PAYMENT_DATE_FUTURE',
  nhan: 'Ngày trả',
  viSao: 'Chỉ ghi được khoản tiền ĐÃ đưa cho nhà cung cấp.',
};

describe('ngày ghi việc ĐÃ xảy ra không được ở tương lai', () => {
  it('hôm nay thì được — đây là ca phổ biến nhất', () => {
    expect(isFutureDate(HOM_NAY, HOM_NAY)).toBe(false);
  });

  it('nhập BÙ phiếu cũ vẫn được: luật chỉ chặn một chiều', () => {
    expect(isFutureDate('2026-10-01', HOM_NAY)).toBe(false);
    expect(isFutureDate('2025-01-15', HOM_NAY)).toBe(false);
  });

  it('ngày mai trở đi thì chặn', () => {
    expect(isFutureDate('2026-10-03', HOM_NAY)).toBe(true);
  });

  it('bắt được cú trượt phím năm — thứ cả luật này sinh ra để chặn', () => {
    // Gõ 2027 thay vì 2026: phiếu nằm im ngoài mọi kỳ báo cáo, trong khi công nợ đã cộng tiền.
    expect(isFutureDate('2027-10-02', HOM_NAY)).toBe(true);
  });

  it('sang tháng / sang năm so đúng chứ không so lệch', () => {
    expect(isFutureDate('2026-11-01', HOM_NAY)).toBe(true);
    expect(isFutureDate('2026-09-30', HOM_NAY)).toBe(false);
    // Ngày 9 lớn hơn ngày 2 cả theo số lẫn theo chuỗi — đúng nhờ định dạng có đệm số 0.
    expect(isFutureDate('2026-10-09', HOM_NAY)).toBe(true);
  });

  it('rỗng hoặc sai định dạng KHÔNG bị hàm này chặn — đó là việc của DTO', () => {
    expect(isFutureDate('', HOM_NAY)).toBe(false);
    expect(isFutureDate(undefined, HOM_NAY)).toBe(false);
    expect(isFutureDate(null, HOM_NAY)).toBe(false);
    expect(isFutureDate('02/10/2026', HOM_NAY)).toBe(false);
    expect(isFutureDate('hôm nay', HOM_NAY)).toBe(false);
  });

  it('khoảng trắng thừa quanh ngày không làm lọt', () => {
    expect(isFutureDate('  2027-01-01  ', HOM_NAY)).toBe(true);
  });

  /**
   * Quán bán tới 3h sáng nên đây KHÔNG phải ca hiếm: nhân viên nhập phiếu lúc 1h sáng ngày 3/10
   * giờ VN, trong khi VPS chạy UTC vẫn đang ở 18h ngày 2/10. Lấy "hôm nay" theo UTC thì ngày
   * họ vừa chọn — đúng hôm nay của họ — sẽ bị từ chối là "tương lai".
   *
   * Hàm này không tự tính hôm nay (xem đầu `delivery-date.ts`), nên test ở đây chốt đúng một
   * điều: truyền vào ngày VN thì ngày VN được chấp nhận.
   */
  it('1h sáng giờ VN: ngày hôm nay của quán được chấp nhận, không bị coi là tương lai', () => {
    const luc1hSangVn = Date.parse('2026-10-02T18:00:00Z'); // = 01:00 ngày 03/10 giờ VN

    expect(todayVn(luc1hSangVn)).toBe('2026-10-03');
    expect(isFutureDate('2026-10-03', todayVn(luc1hSangVn))).toBe(false);
    // Còn nếu ai đó lấy ngày theo UTC thì chính ngày đó thành "tương lai" — ca hỏng cần tránh.
    expect(isFutureDate('2026-10-03', new Date(luc1hSangVn).toISOString().slice(0, 10))).toBe(true);
  });
});

describe('câu báo lỗi', () => {
  it('ngày hợp lệ thì không ném gì', () => {
    expect(() => assertNotFutureDate(HOM_NAY, HOM_NAY, PHIEU)).not.toThrow();
    expect(() => assertNotFutureDate('2026-09-01', HOM_NAY, PHIEU)).not.toThrow();
  });

  it('ngày tương lai ném kèm CẢ HAI con số, để người nhập tự sửa được', () => {
    let caught: unknown;
    try {
      assertNotFutureDate('2027-10-02', HOM_NAY, PHIEU);
    } catch (e) {
      caught = e;
    }
    const body = (caught as { response?: { code?: string; message?: string } })?.response;
    expect(body?.code).toBe('DELIVERY_DATE_FUTURE');
    expect(body?.message).toContain('2027-10-02');
    expect(body?.message).toContain(HOM_NAY);
  });
});

describe('ngày trả tiền NCC — cùng luật, khác câu chữ (2026-10-02)', () => {
  it('ghi bù lần trả hôm qua vẫn được', () => {
    expect(() => assertNotFutureDate('2026-10-01', HOM_NAY, TRA_TIEN)).not.toThrow();
  });

  it('ngày trả ở tương lai bị chặn, và câu lỗi nói đúng ô người dùng đang nhìn', () => {
    let caught: unknown;
    try {
      assertNotFutureDate('2026-12-31', HOM_NAY, TRA_TIEN);
    } catch (e) {
      caught = e;
    }
    const body = (caught as { response?: { code?: string; message?: string } })?.response;
    expect(body?.code).toBe('PAYMENT_DATE_FUTURE');
    expect(body?.message).toContain('Ngày trả');
    expect(body?.message).toContain('2026-12-31');
    expect(body?.message).toContain(HOM_NAY);
  });

  it('hai chỗ gọi dùng MÃ LỖI KHÁC NHAU — để màn hình phân biệt được ô nào sai', () => {
    expect(PHIEU.code).not.toBe(TRA_TIEN.code);
  });
});
