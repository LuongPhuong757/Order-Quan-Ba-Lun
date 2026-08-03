import { describe, expect, it } from 'vitest';
import { checkOrderGuard, type GuardErrorCode, type OrderGuardInput } from './order-guard.js';

// Thứ tự ưu tiên của 4 lớp chống lạm dụng còn lại (D-18). Mỗi case dưới đây chứng minh code có ưu
// tiên cao HƠN "che" code ưu tiên thấp hơn khi nhiều điều kiện xấu xảy ra cùng lúc.
//
// ⚠ 2 `describe` về `MANUAL_OFF` / `OUTSIDE_HOURS` đã bị XOÁ ở plan 09-12, KHÔNG phải hồi quy:
// chúng khẳng định đúng hành vi mà D-11 vừa bỏ (công tắc chặn submit). Đừng "sửa cho xanh" bằng
// cách khôi phục nhánh chặn trong `order-guard.ts` — đó là đi ngược quyết định của chủ dự án
// (T-09-66).

/** 4 mã lỗi CÒN LẠI sau D-11. Dùng cho case hồi quy ngược ở cuối file. */
const REMAINING_CODES: readonly GuardErrorCode[] = [
  'PHONE_BLACKLISTED',
  'TOO_MANY_REQUESTS',
  'ORDER_ALREADY_OPEN_FOR_PHONE',
  'MENU_ITEM_UNAVAILABLE',
];

function baseInput(overrides: Partial<OrderGuardInput> = {}): OrderGuardInput {
  return {
    isBlacklisted: false,
    isRateLimited: false,
    hasOpenOrder: false,
    unavailableItemCodes: [],
    ...overrides,
  };
}

describe('checkOrderGuard — tất cả sạch', () => {
  it('trả null', () => {
    expect(checkOrderGuard(baseInput())).toBeNull();
  });
});

describe('D-11 — công tắc không còn chặn submit', () => {
  it('`OrderGuardInput` KHÔNG còn field `ordering` — đơn đi qua được khi 4 lớp đều sạch', () => {
    // Trước D-11, `ordering.enabled = false` là nhánh chặn đầu tiên và trả
    // `ONLINE_ORDERING_DISABLED`. Nay không có chỗ nào truyền trạng thái công tắc vào guard nữa:
    // 4 khoá dưới đây là TOÀN BỘ bề mặt của input.
    const input = baseInput();
    expect(Object.keys(input).sort()).toEqual([
      'hasOpenOrder',
      'isBlacklisted',
      'isRateLimited',
      'unavailableItemCodes',
    ]);
    expect(checkOrderGuard(input)).toBeNull();
  });

  it('quán Đóng cửa (hay ngoài giờ) không còn là thông tin guard đọc → vẫn null', () => {
    // Ngay cả khi caller cố tình nhét thêm field trạng thái công tắc, guard cũng không đọc nó.
    const withStrayField = { ...baseInput(), ordering: { enabled: false } } as OrderGuardInput;
    expect(checkOrderGuard(withStrayField)).toBeNull();
  });
});

describe('D-18 lớp 1 — blacklist SĐT (ưu tiên cao nhất trong 4 lớp còn lại)', () => {
  it('isBlacklisted=true, mọi cái khác sạch → PHONE_BLACKLISTED', () => {
    expect(checkOrderGuard(baseInput({ isBlacklisted: true }))).toBe('PHONE_BLACKLISTED');
  });

  it('blacklist + rate limit cùng lúc → PHONE_BLACKLISTED (blacklist trước rate limit)', () => {
    const result = checkOrderGuard(baseInput({ isBlacklisted: true, isRateLimited: true }));
    expect(result).toBe('PHONE_BLACKLISTED');
  });

  it('blacklist là lớp đầu tiên: bật đồng thời cả 4 cờ vẫn trả PHONE_BLACKLISTED', () => {
    const result = checkOrderGuard({
      isBlacklisted: true,
      isRateLimited: true,
      hasOpenOrder: true,
      unavailableItemCodes: ['X'],
    });
    expect(result).toBe('PHONE_BLACKLISTED');
  });
});

describe('D-18 lớp 2 — rate limit (ưu tiên trên đơn đang mở)', () => {
  it('isRateLimited=true → TOO_MANY_REQUESTS', () => {
    expect(checkOrderGuard(baseInput({ isRateLimited: true }))).toBe('TOO_MANY_REQUESTS');
  });

  it('rate limit + đang có đơn mở cùng lúc → TOO_MANY_REQUESTS (che ORDER_ALREADY_OPEN_FOR_PHONE)', () => {
    const result = checkOrderGuard(baseInput({ isRateLimited: true, hasOpenOrder: true }));
    expect(result).toBe('TOO_MANY_REQUESTS');
  });
});

describe('D-18 lớp 3 — đơn đang mở cho SĐT (ưu tiên trên món hết hàng)', () => {
  it('hasOpenOrder=true → ORDER_ALREADY_OPEN_FOR_PHONE', () => {
    expect(checkOrderGuard(baseInput({ hasOpenOrder: true }))).toBe('ORDER_ALREADY_OPEN_FOR_PHONE');
  });

  it('có đơn mở + món hết hàng cùng lúc → ORDER_ALREADY_OPEN_FOR_PHONE (che MENU_ITEM_UNAVAILABLE)', () => {
    const result = checkOrderGuard(baseInput({ hasOpenOrder: true, unavailableItemCodes: ['X'] }));
    expect(result).toBe('ORDER_ALREADY_OPEN_FOR_PHONE');
  });
});

describe('D-18 lớp 4 — món hết hàng (ưu tiên thấp nhất)', () => {
  it('unavailableItemCodes có phần tử → MENU_ITEM_UNAVAILABLE', () => {
    expect(checkOrderGuard(baseInput({ unavailableItemCodes: ['X'] }))).toBe('MENU_ITEM_UNAVAILABLE');
  });
});

describe('hồi quy ngược — 2 mã của công tắc không bao giờ được phát ra nữa (D-11)', () => {
  it('quét đủ 16 tổ hợp 4 cờ: kết quả luôn là null hoặc 1 trong 4 mã còn lại', () => {
    const flags = [false, true];
    let combos = 0;
    for (const isBlacklisted of flags) {
      for (const isRateLimited of flags) {
        for (const hasOpenOrder of flags) {
          for (const hasUnavailable of flags) {
            combos++;
            const result = checkOrderGuard({
              isBlacklisted,
              isRateLimited,
              hasOpenOrder,
              unavailableItemCodes: hasUnavailable ? ['X'] : [],
            });
            if (result !== null) {
              expect(REMAINING_CODES).toContain(result);
            }
            // Khẳng định tường minh cho 2 mã đã chết — nếu ai khôi phục nhánh chặn thì case này đỏ.
            expect(result).not.toBe('ONLINE_ORDERING_DISABLED');
            expect(result).not.toBe('STORE_CLOSED');
          }
        }
      }
    }
    expect(combos).toBe(16);
  });
});