import { describe, expect, it } from 'vitest';
import { qrHiddenFor, visibleQrFor } from './qr-visibility.js';

describe('qrHiddenFor', () => {
  it('nhân viên thường nhận đúng danh sách bị ẩn', () => {
    expect(qrHiddenFor({ role: 'order', hidden_payment_qr_ids: ['a', 'b'] })).toEqual(['a', 'b']);
  });

  it('owner và admin luôn thấy hết dù cột có dữ liệu', () => {
    expect(qrHiddenFor({ is_owner: true, role: 'admin', hidden_payment_qr_ids: ['a'] })).toEqual([]);
    expect(qrHiddenFor({ role: 'admin', hidden_payment_qr_ids: ['a'] })).toEqual([]);
  });

  it('NULL hoặc dữ liệu hỏng thì coi như không ẩn gì', () => {
    expect(qrHiddenFor({ role: 'order', hidden_payment_qr_ids: null })).toEqual([]);
    expect(qrHiddenFor({ role: 'order', hidden_payment_qr_ids: 'x' as never })).toEqual([]);
    expect(qrHiddenFor({ role: 'order', hidden_payment_qr_ids: ['a', 1 as never] })).toEqual(['a']);
  });
});

describe('visibleQrFor', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('bỏ mã bị ẩn, giữ thứ tự', () => {
    expect(visibleQrFor(items, ['b'])).toEqual([{ id: 'a' }, { id: 'c' }]);
  });

  it('mã mới (không có trong danh sách ẩn) ai cũng thấy', () => {
    expect(visibleQrFor([...items, { id: 'moi' }], ['a'])).toContainEqual({ id: 'moi' });
  });

  it('không ẩn gì thì trả đủ', () => {
    expect(visibleQrFor(items, [])).toEqual(items);
  });
});
