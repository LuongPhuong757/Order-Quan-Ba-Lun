import { describe, it, expect, beforeEach } from 'vitest';
import { notificationStore } from './notification-store.ts';

describe('notificationStore', () => {
  beforeEach(() => notificationStore.clear());

  it('mặc định là CHƯA đọc → cộng số đỏ trên chuông', () => {
    notificationStore.push('ready', 'Bàn 1 — 2× Phở đã xong');
    expect(notificationStore.unreadCount()).toBe(1);
  });

  // Xác nhận thao tác của chính mình ("Đã lưu") từ 2026-09-21 không còn banner nữa
  // nên phải ghi sổ để xem lại, nhưng KHÔNG được tính chưa đọc — nếu không thì mỗi
  // lần bấm nút là +1, chuông luôn 99+ và che mất thông báo thật (món xong, món mới).
  it('opts.read = ghi sổ nhưng không cộng số đỏ', () => {
    notificationStore.push('info', 'Đã lưu món', undefined, { read: true });
    expect(notificationStore.getAll()).toHaveLength(1);
    expect(notificationStore.unreadCount()).toBe(0);
  });

  it('lỗi vẫn tính là chưa đọc', () => {
    notificationStore.push('error', 'Không thanh toán được', undefined, { read: false });
    expect(notificationStore.unreadCount()).toBe(1);
  });

  it('dedupeKey trùng thì bỏ qua entry mới', () => {
    notificationStore.push('order_checkout', 'Bàn 3 thanh toán', 'checkout:x1');
    notificationStore.push('order_checkout', 'Bàn 3 thanh toán', 'checkout:x1');
    expect(notificationStore.getAll()).toHaveLength(1);
  });
});
