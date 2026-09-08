import { describe, expect, it } from 'vitest';
import { ALLOWED_TRANSITIONS as SCHEMA_TRANSITIONS } from '@order/schemas';
import { ALLOWED_TRANSITIONS as API_TRANSITIONS } from './orders.service.js';

/**
 * State machine của order item nằm ở HAI chỗ: `packages/schemas/src/orders.ts` (FE đọc để
 * biết hiện nút nào) và `orders.service.ts` (BE validate). Comment ở cả hai chỗ đều nói
 * "must match" nhưng trước đây không có gì kiểm — và đúng chỗ đó đã hỏng: màn Bếp đổi sang
 * một nút "xong" duy nhất, gửi KITCHEN → READY, mà BE chưa mở transition đó nên MỌI lần bấm
 * đều trả 409 "Dữ liệu xung đột". Test này khoá lại: sửa một bên mà quên bên kia là đỏ.
 */
describe('ALLOWED_TRANSITIONS — hai bản đồ ở 2 package phải khớp tuyệt đối', () => {
  it('cùng tập state', () => {
    expect(Object.keys(API_TRANSITIONS).sort()).toEqual(Object.keys(SCHEMA_TRANSITIONS).sort());
  });

  it('cùng tập đích cho từng state', () => {
    for (const state of Object.keys(SCHEMA_TRANSITIONS)) {
      expect([...(API_TRANSITIONS[state] ?? [])].sort(), `state ${state}`).toEqual(
        [...SCHEMA_TRANSITIONS[state as keyof typeof SCHEMA_TRANSITIONS]].sort(),
      );
    }
  });
});

describe('Bếp 1 nút: KITCHEN → READY phải hợp lệ', () => {
  it('bếp bấm "xong" từ dòng chưa nấu — không phải đi qua COOKING nữa', () => {
    expect(API_TRANSITIONS.KITCHEN).toContain('READY');
    expect(SCHEMA_TRANSITIONS.KITCHEN).toContain('READY');
  });

  it('COOKING vẫn còn: màn Order set được, đơn online đọc để vẽ thanh tiến trình', () => {
    expect(API_TRANSITIONS.KITCHEN).toContain('COOKING');
    expect(API_TRANSITIONS.COOKING).toContain('READY');
  });

  it('không mở thêm đường tắt nào ngoài dự tính từ KITCHEN', () => {
    expect([...API_TRANSITIONS.KITCHEN].sort()).toEqual(['CANCELLED', 'COOKING', 'READY', 'SERVED']);
  });

  it('READY vẫn không quay lùi được', () => {
    expect(API_TRANSITIONS.READY).toEqual(['SERVED', 'CANCELLED']);
  });
});
