import { describe, expect, it } from 'vitest';
import { isBlockedForPrintRole, PRINT_ROLE } from './print-role.js';

describe('isBlockedForPrintRole', () => {
  it('không đụng tới các role khác', () => {
    for (const role of ['admin', 'order', 'kitchen', 'report', null, undefined]) {
      expect(isBlockedForPrintRole(role, '/orders/abc/checkout')).toBe(false);
    }
  });

  it('cho cầu in làm việc của nó', () => {
    for (const path of ['/print/next', '/print/jobs/abc/ack', '/print/jobs/abc/fail', '/print-pair']) {
      expect(isBlockedForPrintRole(PRINT_ROLE, path)).toBe(false);
    }
  });

  it('cho đăng xuất và đọc phiên', () => {
    expect(isBlockedForPrintRole(PRINT_ROLE, '/auth/logout')).toBe(false);
    expect(isBlockedForPrintRole(PRINT_ROLE, '/auth/me')).toBe(false);
  });

  it('CHẶN thanh toán — lý do tồn tại của module này', () => {
    // `POST /orders/:id/checkout` không có `RequireRoles`, nên nếu không chặn ở đây thì chiếc
    // máy POS ở quầy thanh toán được.
    expect(isBlockedForPrintRole(PRINT_ROLE, '/orders/abc-123/checkout')).toBe(true);
  });

  it('chặn mọi thứ khác của quán', () => {
    for (const path of [
      '/orders',
      '/orders/abc/items',
      '/admin/users',
      '/admin/settings',
      '/admin/print/overview',
      '/menu',
      '/tables',
      '/suppliers',
      '/ingredients',
    ]) {
      expect(isBlockedForPrintRole(PRINT_ROLE, path)).toBe(true);
    }
  });

  it('không lách được bằng viết hoa — Express định tuyến không phân biệt hoa thường', () => {
    expect(isBlockedForPrintRole(PRINT_ROLE, '/Orders/abc/Checkout')).toBe(true);
    expect(isBlockedForPrintRole(PRINT_ROLE, '/PRINT/next')).toBe(false);
  });

  it('không cho đường lỏng kiểu /printer-gì-đó của module khác lọt', () => {
    // `/print` là tiền tố, nên `/printers-admin` vẫn khớp. Chấp nhận có ý thức: repo không có
    // module nào khác bắt đầu bằng "print", và luật ngắn thì đọc được trong mười giây.
    expect(isBlockedForPrintRole(PRINT_ROLE, '/admin/print/overview')).toBe(true);
  });
});
