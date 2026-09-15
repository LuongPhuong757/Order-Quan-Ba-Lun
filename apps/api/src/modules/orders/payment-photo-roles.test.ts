// Ai được chạm vào ảnh bill chuyển khoản (2026-09-15, sau sự cố trên production).
//
// VÌ SAO CẦN TEST NÀY: `POST /orders/:id/checkout` KHÔNG gác role — mọi người đăng nhập được
// (trừ role chỉ-đọc `report`, bị `JwtAuthGuard` chặn ở mọi phương thức ghi) đều thu tiền được,
// kể cả BẾP. Nhưng ba endpoint ảnh bill lại gác `RequireRoles('admin','order')`, bỏ quên bếp.
// Kết quả trên quán thật: bếp cầm máy lúc đông khách đi được hết luồng — chọn mã, khách quét,
// xác nhận thu — rồi tới bước chụp bill thì ăn 403 "Bạn không có quyền xem mục này".
//
// Bất biến phải giữ: AI THU ĐƯỢC TIỀN THÌ PHẢI CHỤP ĐƯỢC BILL CỦA ĐÚNG ĐƠN ĐÓ. Danh sách role
// tách thành hằng số để kiểm được ở đây — chốt quyền THẬT vẫn là công tắc `can_collect_transfer`
// theo từng người (xem `assertCanCollectTransfer`), danh sách này chỉ là lớp thô bên ngoài.
import { describe, expect, it } from 'vitest';
import { PAYMENT_PHOTO_READ_ROLES, PAYMENT_PHOTO_WRITE_ROLES } from './payment-photo-roles.js';

/** Role thu được tiền qua `POST /orders/:id/checkout` — endpoint đó không có `RequireRoles` nào,
 *  nên đây là mọi role ghi được của app. `report` KHÔNG nằm đây: nó là role chỉ đọc. */
const ROLES_CO_THE_THU_TIEN = ['admin', 'order', 'kitchen'] as const;

describe('quyền chạm vào ảnh bill', () => {
  it.each(ROLES_CO_THE_THU_TIEN)('role %s thu được tiền thì phải CHỤP được bill', (role) => {
    expect(PAYMENT_PHOTO_WRITE_ROLES).toContain(role);
  });

  it.each(ROLES_CO_THE_THU_TIEN)('role %s chụp được thì phải XEM LẠI được', (role) => {
    expect(PAYMENT_PHOTO_READ_ROLES).toContain(role);
  });

  it('role chỉ-đọc `report` xem được (để đối soát) nhưng KHÔNG ghi', () => {
    expect(PAYMENT_PHOTO_READ_ROLES).toContain('report');
    expect(PAYMENT_PHOTO_WRITE_ROLES).not.toContain('report');
  });

  it('không có role lạ lọt vào', () => {
    const biet = new Set(['admin', 'order', 'kitchen', 'report']);
    for (const r of [...PAYMENT_PHOTO_READ_ROLES, ...PAYMENT_PHOTO_WRITE_ROLES]) {
      expect(biet.has(r), `role lạ: ${r}`).toBe(true);
    }
  });
});
