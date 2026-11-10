import { describe, expect, it } from 'vitest';
import { GUEST_IP_CEILING_PER_MIN, guestThrottleKey, isGuestTableRoute } from './guest-throttle-key.js';

const TOKEN_A = 'a'.repeat(64);
const TOKEN_B = '0123456789abcdef'.repeat(4);

const req = (url: string, opts: { header?: string; body?: unknown } = {}) => ({
  originalUrl: url,
  headers: opts.header ? { 'x-guest-token': opts.header } : {},
  body: opts.body,
});

describe('isGuestTableRoute', () => {
  it('chỉ nhận các route khách gọi món tại bàn', () => {
    expect(isGuestTableRoute(req('/api/public/table/open'))).toBe(true);
    expect(isGuestTableRoute(req('/api/public/table/state?x=1'))).toBe(true);
    expect(isGuestTableRoute(req('/api/public/orders'))).toBe(false);
    expect(isGuestTableRoute(req('/orders/abc/checkout'))).toBe(false);
    expect(isGuestTableRoute(req('/auth/login'))).toBe(false);
  });
});

describe('guestThrottleKey — mỗi khách một ô đếm, không chung IP cả quán', () => {
  it('poll trạng thái: đếm theo token ở header', () => {
    expect(guestThrottleKey(req('/api/public/table/state', { header: TOKEN_A }))).toBe(`guest:${TOKEN_A}`);
  });

  it('gửi món / gọi nhân viên: đếm theo token trong body', () => {
    expect(guestThrottleKey(req('/api/public/table/cart', { body: { guest_token: TOKEN_B } }))).toBe(`guest:${TOKEN_B}`);
    expect(guestThrottleKey(req('/api/public/table/call', { body: { guest_token: TOKEN_A } }))).toBe(`guest:${TOKEN_A}`);
  });

  it('hai khách khác token → hai ô đếm khác nhau', () => {
    const a = guestThrottleKey(req('/api/public/table/cart', { body: { guest_token: TOKEN_A } }));
    const b = guestThrottleKey(req('/api/public/table/cart', { body: { guest_token: TOKEN_B } }));
    expect(a).not.toBe(b);
  });

  it('mở bàn lần đầu (chưa token): đếm theo SỐ BÀN, chuẩn hoá giống lúc khớp bàn', () => {
    const k = (t: string) => guestThrottleKey(req('/api/public/table/open', { body: { table_input: t } }));
    expect(k('5')).toBe('guest-open:5');
    expect(k('bàn 05')).toBe('guest-open:5');
    expect(k('B05')).toBe('guest-open:5');
    expect(k('12')).not.toBe(k('5'));
  });

  it('mở lại bàn có kèm token cũ → đếm theo token', () => {
    expect(
      guestThrottleKey(req('/api/public/table/open', { body: { table_input: '5', guest_token: TOKEN_A } })),
    ).toBe(`guest:${TOKEN_A}`);
  });

  it('token sai khuôn / thiếu / input rỗng → null (rơi về đếm theo IP như cũ)', () => {
    expect(guestThrottleKey(req('/api/public/table/state', { header: 'abc' }))).toBeNull();
    expect(guestThrottleKey(req('/api/public/table/state', { header: 'A'.repeat(64) }))).toBeNull();
    expect(guestThrottleKey(req('/api/public/table/cart', { body: { guest_token: 123 } }))).toBeNull();
    expect(guestThrottleKey(req('/api/public/table/open', { body: { table_input: 'abc' } }))).toBeNull();
    expect(guestThrottleKey(req('/api/public/table/open', { body: { table_input: '9'.repeat(40) } }))).toBeNull();
    expect(guestThrottleKey(req('/api/public/table/open'))).toBeNull();
  });

  it('route không phải của khách tại bàn → null', () => {
    expect(guestThrottleKey(req('/api/public/orders', { header: TOKEN_A }))).toBeNull();
  });

  it('trần chung theo IP đủ cho 30 bàn poll 5s + gửi món, nhưng vẫn là trần hữu hạn', () => {
    const polls30Tables = 30 * 12;
    expect(GUEST_IP_CEILING_PER_MIN).toBeGreaterThan(polls30Tables * 2);
    expect(GUEST_IP_CEILING_PER_MIN).toBeLessThanOrEqual(2000);
  });
});
