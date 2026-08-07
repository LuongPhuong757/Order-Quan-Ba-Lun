// Khoá quy tắc "order + bếp chỉ xem đơn đặt trong 14h, admin xem hết" (chỉ đạo 2026-08-06).
//
// Đây là lớp chặn QUYỀN, không phải tiện ích hiển thị: nếu ai đó sửa `resolveOnlineWindow` cho
// "gọn" mà làm nhánh nhân viên trả `undefined`, màn duyệt đơn của bếp lặng lẽ mở lại toàn bộ
// lịch sử đơn online — không có lỗi nào nổ ra để biết.
import { describe, expect, it } from 'vitest';
import { STAFF_ONLINE_WINDOW_HOURS } from '@order/schemas';
import { resolveOnlineWindow, STAFF_ONLINE_WINDOW_MS } from './online-window.js';

const HOUR = 60 * 60 * 1000;

describe('resolveOnlineWindow — cửa sổ xem đơn online theo role', () => {
  it('admin không gửi `hours` → không giới hạn', () => {
    expect(resolveOnlineWindow('admin', undefined)).toEqual({
      maxAgeMs: undefined,
      windowHours: null,
    });
  });

  it('admin gửi `hours` → đúng khoảng đó, kể cả rộng hơn 14h', () => {
    expect(resolveOnlineWindow('admin', 720)).toEqual({
      maxAgeMs: 720 * HOUR,
      windowHours: 720,
    });
  });

  it.each(['order', 'kitchen'] as const)('%s không gửi gì → bị ghim ở 14h', (role) => {
    expect(resolveOnlineWindow(role, undefined)).toEqual({
      maxAgeMs: STAFF_ONLINE_WINDOW_MS,
      windowHours: STAFF_ONLINE_WINDOW_HOURS,
    });
  });

  it.each(['order', 'kitchen'] as const)(
    '%s gõ tay `?hours=720` KHÔNG nới rộng được — vẫn 14h',
    (role) => {
      expect(resolveOnlineWindow(role, 720)).toEqual({
        maxAgeMs: STAFF_ONLINE_WINDOW_MS,
        windowHours: STAFF_ONLINE_WINDOW_HOURS,
      });
    },
  );

  it('nhân viên được phép thu HẸP hơn 14h (xem ca đang trực)', () => {
    expect(resolveOnlineWindow('order', 4)).toEqual({ maxAgeMs: 4 * HOUR, windowHours: 4 });
  });

  it('role không xác định → xử như nhân viên, không phải như admin', () => {
    expect(resolveOnlineWindow(null, undefined).maxAgeMs).toBe(STAFF_ONLINE_WINDOW_MS);
    expect(resolveOnlineWindow(null, 720).maxAgeMs).toBe(STAFF_ONLINE_WINDOW_MS);
  });

  it('14h đúng bằng 14 tiếng ms — con số này đi vào câu WHERE của DB', () => {
    expect(STAFF_ONLINE_WINDOW_MS).toBe(14 * 60 * 60 * 1000);
  });
});
