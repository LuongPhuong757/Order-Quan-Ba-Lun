import { describe, expect, it } from 'vitest';
import {
  DINE_IN_CART_TTL_MS,
  DINE_IN_CODE_LEN,
  dineInCartExpiresInMs,
  dineInCartState,
  generateDineInCode,
  isValidDineInCode,
  luhnCheckDigit,
} from './dine-in-code.js';

describe('luhnCheckDigit — khớp thuật toán Luhn chuẩn', () => {
  it('ví dụ kinh điển: thân 7992739871 có số kiểm tra 3', () => {
    expect(luhnCheckDigit('7992739871')).toBe(3);
  });

  it('thân toàn 0 thì số kiểm tra là 0', () => {
    expect(luhnCheckDigit('0000')).toBe(0);
  });

  it('luôn trả về đúng 1 chữ số 0..9', () => {
    for (let n = 0; n < 10_000; n++) {
      const d = luhnCheckDigit(String(n).padStart(4, '0'));
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(9);
    }
  });
});

describe('isValidDineInCode', () => {
  it('nhận mọi mã do generateDineInCode sinh ra', () => {
    for (let i = 0; i < 500; i++) {
      const code = generateDineInCode();
      expect(code).toHaveLength(DINE_IN_CODE_LEN);
      expect(isValidDineInCode(code), code).toBe(true);
    }
  });

  it('loại mã sai độ dài', () => {
    expect(isValidDineInCode('4271')).toBe(false);
    expect(isValidDineInCode('427135')).toBe(false);
    expect(isValidDineInCode('')).toBe(false);
  });

  it('loại mã có ký tự không phải chữ số', () => {
    expect(isValidDineInCode('427a3')).toBe(false);
    expect(isValidDineInCode('4271 ')).toBe(false);
    expect(isValidDineInCode('-4271')).toBe(false);
    // Chuỗi mà Number() vẫn ép được nhưng KHÔNG phải 5 chữ số — chốt lại là không lọt.
    expect(isValidDineInCode('4.271')).toBe(false);
  });

  /**
   * ĐÂY LÀ LÝ DO SỐ KIỂM TRA TỒN TẠI (M4.D-04). Với QR chung, gõ sai một chữ số mà lọt qua
   * thành mã hợp lệ của giỏ khác = món ra sai bàn. Test này khoá lại: sai 1 chữ số ở BẤT KỲ
   * vị trí nào, trên mọi mã trong toàn bộ không gian mã, đều bị bắt.
   */
  it('bắt 100% lỗi sai một chữ số', () => {
    for (let n = 0; n < 10_000; n++) {
      const body = String(n).padStart(4, '0');
      const code = body + String(luhnCheckDigit(body));
      for (let pos = 0; pos < DINE_IN_CODE_LEN; pos++) {
        for (let d = 0; d <= 9; d++) {
          if (code[pos] === String(d)) continue;
          const typo = code.slice(0, pos) + String(d) + code.slice(pos + 1);
          expect(isValidDineInCode(typo), `${code} → ${typo}`).toBe(false);
        }
      }
    }
  });

  /** Lỗi thường gặp thứ hai khi đọc số qua tiếng nói: đảo hai chữ số liền kề. Luhn bắt hết
   * TRỪ cặp 0↔9 — đó là giới hạn đã biết của thuật toán, ghi ra đây để không ai tưởng là bug. */
  it('bắt lỗi đảo hai chữ số liền kề, trừ cặp 09/90', () => {
    let missed = 0;
    let checked = 0;
    for (let n = 0; n < 10_000; n++) {
      const body = String(n).padStart(4, '0');
      const code = body + String(luhnCheckDigit(body));
      for (let pos = 0; pos < DINE_IN_CODE_LEN - 1; pos++) {
        const a = code[pos]!;
        const b = code[pos + 1]!;
        if (a === b) continue;
        const swapped = code.slice(0, pos) + b + a + code.slice(pos + 2);
        checked++;
        if (isValidDineInCode(swapped)) {
          missed++;
          const pair = [a, b].sort().join('');
          expect(pair, `${code} → ${swapped} lọt mà không phải cặp 09`).toBe('09');
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
    // Có lọt, nhưng chỉ đúng cặp 09 — tỷ lệ nhỏ, và đã được assert từng ca ở trên.
    expect(missed / checked).toBeLessThan(0.05);
  });
});

describe('dineInCartState — suy trạng thái từ mốc thời gian, không có cột status', () => {
  const base = { used_at: null, cancelled_at: null, expires_at: 1_000 };

  it('còn hạn, chưa dùng, chưa huỷ → ACTIVE', () => {
    expect(dineInCartState(base, 999)).toBe('ACTIVE');
  });

  it('quá hạn → EXPIRED', () => {
    expect(dineInCartState(base, 1_000)).toBe('EXPIRED');
    expect(dineInCartState(base, 5_000)).toBe('EXPIRED');
  });

  it('đã huỷ → CANCELLED, kể cả khi còn hạn', () => {
    expect(dineInCartState({ ...base, cancelled_at: 500 }, 600)).toBe('CANCELLED');
  });

  /** USED thắng tất cả: món đã vào bill thì câu báo cho nhân viên phải là "mã đã dùng bởi ai,
   * bàn nào" (M4.D-13), không phải "mã hết hạn". */
  it('đã dùng → USED, thắng cả EXPIRED và CANCELLED', () => {
    expect(dineInCartState({ ...base, used_at: 500 }, 600)).toBe('USED');
    expect(dineInCartState({ ...base, used_at: 500 }, 99_999)).toBe('USED');
    expect(dineInCartState({ used_at: 500, cancelled_at: 400, expires_at: 1_000 }, 600)).toBe('USED');
  });
});

describe('dineInCartExpiresInMs', () => {
  it('trả thời gian còn lại khi ACTIVE', () => {
    expect(dineInCartExpiresInMs({ used_at: null, cancelled_at: null, expires_at: 1_000 }, 400)).toBe(600);
  });

  it('trả 0 với mọi trạng thái không ACTIVE — FE không phải lo số âm', () => {
    expect(dineInCartExpiresInMs({ used_at: null, cancelled_at: null, expires_at: 1_000 }, 2_000)).toBe(0);
    expect(dineInCartExpiresInMs({ used_at: 5, cancelled_at: null, expires_at: 1_000 }, 400)).toBe(0);
    expect(dineInCartExpiresInMs({ used_at: null, cancelled_at: 5, expires_at: 1_000 }, 400)).toBe(0);
  });
});

describe('hằng số', () => {
  it('TTL 15 phút — M4.D-12', () => {
    expect(DINE_IN_CART_TTL_MS).toBe(900_000);
  });

  it('mã 5 chữ số — M4.D-04; đổi số này là đổi hợp đồng với nhân viên', () => {
    expect(DINE_IN_CODE_LEN).toBe(5);
  });
});
