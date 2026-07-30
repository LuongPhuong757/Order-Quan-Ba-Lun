// docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md §7 dòng 461-463 — thứ tự kiểm tra ĐÃ CHỐT:
//   ordering_enabled → is_open_now → phone not blacklisted → rate limit
//   → no open order for phone → món còn hàng
// Đổi thứ tự trong hàm này là đổi hành vi nghiệp vụ — phải sửa test tương ứng (order-guard.test.ts).
//
// Module thuần: hàm chỉ nhận boolean/array ĐÃ FETCH SẴN, không tự query DB, không import
// bất kỳ thứ gì từ Nest hay ORM. Service gọi hàm này sau khi tự fetch 5 giá trị.
import type { OrderingStatus } from './store-status.js';

export type OrderGuardInput = {
  ordering: OrderingStatus;
  isBlacklisted: boolean;
  isRateLimited: boolean;
  hasOpenOrder: boolean;
  unavailableItemCodes: string[]; // rỗng nếu tất cả còn hàng
};

export type GuardErrorCode =
  | 'ONLINE_ORDERING_DISABLED'
  | 'STORE_CLOSED'
  | 'PHONE_BLACKLISTED'
  | 'TOO_MANY_REQUESTS'
  | 'ORDER_ALREADY_OPEN_FOR_PHONE'
  | 'MENU_ITEM_UNAVAILABLE';

export function checkOrderGuard(input: OrderGuardInput): GuardErrorCode | null {
  if (!input.ordering.enabled) {
    return input.ordering.blocking_reason === 'OUTSIDE_HOURS'
      ? 'STORE_CLOSED'
      : 'ONLINE_ORDERING_DISABLED';
  }
  if (input.isBlacklisted) return 'PHONE_BLACKLISTED';
  if (input.isRateLimited) return 'TOO_MANY_REQUESTS';
  if (input.hasOpenOrder) return 'ORDER_ALREADY_OPEN_FOR_PHONE';
  if (input.unavailableItemCodes.length > 0) return 'MENU_ITEM_UNAVAILABLE';
  return null;
}
