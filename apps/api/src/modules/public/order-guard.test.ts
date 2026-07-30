import { describe, expect, it } from 'vitest';
import { checkOrderGuard, type OrderGuardInput } from './order-guard.js';
import type { OrderingStatus } from './store-status.js';

// docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md §7 dòng 461-463 — thứ tự ưu tiên ĐÃ CHỐT.
// Mỗi case dưới đây chứng minh code có ưu tiên cao HƠN "che" code ưu tiên thấp hơn khi
// nhiều điều kiện xấu xảy ra cùng lúc.

const ENABLED: OrderingStatus = { enabled: true, is_open_now: true, blocking_reason: null };
const MANUAL_OFF: OrderingStatus = { enabled: false, is_open_now: true, blocking_reason: 'MANUAL_OFF' };
const OUTSIDE_HOURS: OrderingStatus = {
  enabled: false,
  is_open_now: false,
  blocking_reason: 'OUTSIDE_HOURS',
};

function baseInput(overrides: Partial<OrderGuardInput> = {}): OrderGuardInput {
  return {
    ordering: ENABLED,
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

describe('checkOrderGuard — công tắc OFF thủ công (ưu tiên cao nhất)', () => {
  it('MANUAL_OFF → ONLINE_ORDERING_DISABLED', () => {
    expect(checkOrderGuard(baseInput({ ordering: MANUAL_OFF }))).toBe('ONLINE_ORDERING_DISABLED');
  });

  it('OUTSIDE_HOURS → STORE_CLOSED', () => {
    expect(checkOrderGuard(baseInput({ ordering: OUTSIDE_HOURS }))).toBe('STORE_CLOSED');
  });

  it('công tắc OFF + blacklist cùng lúc → vẫn trả code của công tắc (che PHONE_BLACKLISTED)', () => {
    const result = checkOrderGuard(
      baseInput({ ordering: MANUAL_OFF, isBlacklisted: true }),
    );
    expect(result).toBe('ONLINE_ORDERING_DISABLED');
  });
});

describe('checkOrderGuard — blacklist SĐT (ưu tiên trên rate limit)', () => {
  it('isBlacklisted=true, mọi cái khác sạch → PHONE_BLACKLISTED', () => {
    expect(checkOrderGuard(baseInput({ isBlacklisted: true }))).toBe('PHONE_BLACKLISTED');
  });

  it('blacklist + rate limit cùng lúc → PHONE_BLACKLISTED (blacklist trước rate limit)', () => {
    const result = checkOrderGuard(
      baseInput({ isBlacklisted: true, isRateLimited: true }),
    );
    expect(result).toBe('PHONE_BLACKLISTED');
  });
});

describe('checkOrderGuard — rate limit (ưu tiên trên đơn đang mở)', () => {
  it('isRateLimited=true → TOO_MANY_REQUESTS', () => {
    expect(checkOrderGuard(baseInput({ isRateLimited: true }))).toBe('TOO_MANY_REQUESTS');
  });

  it('rate limit + đang có đơn mở cùng lúc → TOO_MANY_REQUESTS (che ORDER_ALREADY_OPEN_FOR_PHONE)', () => {
    const result = checkOrderGuard(
      baseInput({ isRateLimited: true, hasOpenOrder: true }),
    );
    expect(result).toBe('TOO_MANY_REQUESTS');
  });
});

describe('checkOrderGuard — đơn đang mở cho SĐT (ưu tiên trên món hết hàng)', () => {
  it('hasOpenOrder=true → ORDER_ALREADY_OPEN_FOR_PHONE', () => {
    expect(checkOrderGuard(baseInput({ hasOpenOrder: true }))).toBe('ORDER_ALREADY_OPEN_FOR_PHONE');
  });

  it('có đơn mở + món hết hàng cùng lúc → ORDER_ALREADY_OPEN_FOR_PHONE (che MENU_ITEM_UNAVAILABLE)', () => {
    const result = checkOrderGuard(
      baseInput({ hasOpenOrder: true, unavailableItemCodes: ['X'] }),
    );
    expect(result).toBe('ORDER_ALREADY_OPEN_FOR_PHONE');
  });
});

describe('checkOrderGuard — món hết hàng (ưu tiên thấp nhất)', () => {
  it('unavailableItemCodes có phần tử → MENU_ITEM_UNAVAILABLE', () => {
    expect(checkOrderGuard(baseInput({ unavailableItemCodes: ['X'] }))).toBe('MENU_ITEM_UNAVAILABLE');
  });
});
