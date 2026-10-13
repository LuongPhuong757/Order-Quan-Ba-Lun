import { describe, expect, it } from 'vitest';
import { GUEST_CODE_MAX_TRIES, isWeakGuestCode, pickGuestCode } from './guest-code.js';

// M7.D-04/D-17 — mã bàn 4 chữ số, sinh ở lần BÁO BẾP đầu tiên của bàn.
// M7.R2 — 4 chữ số chỉ có 10.000 tổ hợp. Mã dễ đoán bị loại để kẻ dò không
// "trúng số" bằng vài lần thử đầu tiên; `rng` bơm từ ngoài vào để test xác định
// được, production truyền `randomInt` của node:crypto (CSPRNG).

/** rng giả: trả lần lượt các số đã định, hết thì lặp lại số cuối. */
const rngOf = (...values: number[]) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)]!;
};

describe('isWeakGuestCode — loại mã dễ đoán', () => {
  it('loại 0000 và mọi dãy toàn một chữ số', () => {
    for (const c of ['0000', '1111', '5555', '9999']) {
      expect(isWeakGuestCode(c), c).toBe(true);
    }
  });

  it('loại 1234 và 4321', () => {
    expect(isWeakGuestCode('1234')).toBe(true);
    expect(isWeakGuestCode('4321')).toBe(true);
  });

  it('mã bình thường không bị loại', () => {
    for (const c of ['7312', '0531', '9048']) {
      expect(isWeakGuestCode(c), c).toBe(false);
    }
  });
});

describe('pickGuestCode — hình dạng mã', () => {
  it('luôn đúng 4 chữ số, giữ cả số 0 đứng đầu', () => {
    const code = pickGuestCode(new Set(), rngOf(531));
    expect(code).toBe('0531');
  });
});

describe('pickGuestCode — bỏ qua mã yếu và mã đã bị chiếm', () => {
  it('rng ra mã yếu thì thử tiếp, không trả mã yếu', () => {
    const code = pickGuestCode(new Set(), rngOf(1234, 7312));
    expect(code).toBe('7312');
  });

  it('rng ra mã đang bị bàn khác giữ thì thử tiếp', () => {
    const code = pickGuestCode(new Set(['7312']), rngOf(7312, 4087));
    expect(code).toBe('4087');
  });
});

describe('pickGuestCode — không bao giờ lặp vô hạn (M7.D-15 cũ: báo lỗi rõ)', () => {
  it('rng luôn trả cùng một mã đã bị chiếm → trả null sau đúng số lần thử tối đa', () => {
    let calls = 0;
    const rng = () => {
      calls++;
      return 7312;
    };
    expect(pickGuestCode(new Set(['7312']), rng)).toBeNull();
    expect(calls).toBe(GUEST_CODE_MAX_TRIES);
  });
});
