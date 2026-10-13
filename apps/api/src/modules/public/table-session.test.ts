import { describe, expect, it } from 'vitest';
import { isGuestSessionAlive, type GuestSessionLike, type OrderLike } from './table-session.js';

// M7.D-06 — mã bàn sống đến khi THANH TOÁN XONG. M7.D-19 — bất biến: phiên sống ⟺ bàn còn
// đang ăn. Hàm này là nơi duy nhất quyết định điều đó, nên mọi ca 410 SESSION_ENDED của
// màn khách đều bắt nguồn từ đây.

const NOW = 1_700_000_000_000;
const sess = (over: Partial<GuestSessionLike> = {}): GuestSessionLike => ({
  order_id: null,
  expires_at: NOW + 60_000,
  revoked_at: null,
  ...over,
});
const openOrder: OrderLike = { closed_at: null };
const closedOrder: OrderLike = { closed_at: NOW - 1_000 };

describe('isGuestSessionAlive — phiên chưa gắn đơn', () => {
  it('còn hạn, chưa revoke → sống', () => {
    expect(isGuestSessionAlive(sess(), null, NOW)).toBe(true);
  });
});

describe('isGuestSessionAlive — bốn nhánh giết phiên', () => {
  it('đã revoke → chết, dù còn hạn', () => {
    expect(isGuestSessionAlive(sess({ revoked_at: NOW - 1 }), null, NOW)).toBe(false);
  });

  it('quá hạn → chết', () => {
    expect(isGuestSessionAlive(sess({ expires_at: NOW - 1 }), null, NOW)).toBe(false);
  });

  it('BIÊN: expires_at đúng bằng now → coi là HẾT hạn', () => {
    expect(isGuestSessionAlive(sess({ expires_at: NOW }), null, NOW)).toBe(false);
  });

  it('phiên gắn đơn ĐÃ ĐÓNG → chết (nguồn của 410 SESSION_ENDED)', () => {
    expect(isGuestSessionAlive(sess({ order_id: 'o1' }), closedOrder, NOW)).toBe(false);
  });
});

describe('isGuestSessionAlive — phiên đã gắn đơn còn mở', () => {
  it('đơn còn mở → sống', () => {
    expect(isGuestSessionAlive(sess({ order_id: 'o1' }), openOrder, NOW)).toBe(true);
  });

  it('gắn đơn mà KHÔNG tra được đơn → chết, không đoán là còn sống', () => {
    expect(isGuestSessionAlive(sess({ order_id: 'o1' }), null, NOW)).toBe(false);
  });
});
