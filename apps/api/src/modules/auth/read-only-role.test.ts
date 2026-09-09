// Khoá chỉ đạo của chủ quán (2026-09-09): role `report` "tuyệt đối không thao tác ghi gì vào
// DB — không order, không thanh toán, không tạo bất cứ cái gì".
//
// Đây là lớp chặn QUYỀN duy nhất bảo đảm điều đó. Web có ẩn nút hay không chỉ là tiện lợi; ai
// gõ thẳng URL hoặc gọi curl vẫn phải chết ở đây. Sửa `read-only-role.ts` cho "gọn" mà làm
// một nhánh trả `false` nhầm thì role Báo cáo lặng lẽ order/thanh toán được, và KHÔNG có lỗi
// nào nổ ra để biết — nên các case dưới đây là hàng rào, không phải trang trí.
import { describe, expect, it } from 'vitest';
import { isBlockedWrite } from './read-only-role.js';

describe('isBlockedWrite — chặn ghi cho role Báo cáo', () => {
  it('role report: mọi GET đều cho qua', () => {
    expect(isBlockedWrite('report', 'GET', '/orders/stats')).toBe(false);
    expect(isBlockedWrite('report', 'GET', '/supplier-reports/food-cost?from=2026-01-01')).toBe(
      false,
    );
    expect(isBlockedWrite('report', 'HEAD', '/menu')).toBe(false);
    expect(isBlockedWrite('report', 'OPTIONS', '/menu')).toBe(false);
  });

  it('role report: chặn đúng những thao tác chủ quán đã gọi tên', () => {
    // order món vào bàn
    expect(isBlockedWrite('report', 'POST', '/orders/abc/items')).toBe(true);
    // thanh toán
    expect(isBlockedWrite('report', 'POST', '/orders/abc/checkout')).toBe(true);
    // tạo mới (món, bàn, NCC, phiếu nhập, nhân viên)
    expect(isBlockedWrite('report', 'POST', '/menu')).toBe(true);
    expect(isBlockedWrite('report', 'POST', '/tables')).toBe(true);
    expect(isBlockedWrite('report', 'POST', '/suppliers')).toBe(true);
    expect(isBlockedWrite('report', 'POST', '/supplier-deliveries')).toBe(true);
    expect(isBlockedWrite('report', 'POST', '/admin/users')).toBe(true);
    // sửa / xoá
    expect(isBlockedWrite('report', 'PATCH', '/menu/xyz')).toBe(true);
    expect(isBlockedWrite('report', 'PUT', '/admin/settings')).toBe(true);
    expect(isBlockedWrite('report', 'DELETE', '/suppliers/xyz')).toBe(true);
  });

  it('role report: chặn cả method lạ và method viết thường', () => {
    // Danh sách TRẮNG theo method — cái gì không phải GET/HEAD/OPTIONS là cấm, kể cả method
    // chưa từng dùng trong repo. Route ghi thêm sau này tự động rơi vào nhánh này.
    expect(isBlockedWrite('report', 'PROPFIND', '/gì-đó')).toBe(true);
    expect(isBlockedWrite('report', 'post', '/orders/abc/checkout')).toBe(true);
  });

  it('role report: chỉ mở đúng 2 ngoại lệ — đăng xuất và tự đổi mật khẩu', () => {
    expect(isBlockedWrite('report', 'POST', '/auth/logout')).toBe(false);
    expect(isBlockedWrite('report', 'POST', '/auth/change-password')).toBe(false);
    // biến thể vô hại của cùng đường dẫn vẫn phải nhận ra
    expect(isBlockedWrite('report', 'POST', '/auth/logout/')).toBe(false);
    expect(isBlockedWrite('report', 'POST', '/auth/change-password?next=/')).toBe(false);
    // nhưng KHÔNG được mở lây sang đường khác cùng nhánh `/auth`
    expect(isBlockedWrite('report', 'POST', '/auth/recover')).toBe(true);
    expect(isBlockedWrite('report', 'POST', '/auth/logout/all')).toBe(true);
    // và đổi mật khẩu NGƯỜI KHÁC là đường của admin, không phải ngoại lệ này
    expect(isBlockedWrite('report', 'POST', '/admin/users/abc/password')).toBe(true);
  });

  it('role khác không bị đụng tới', () => {
    for (const role of ['admin', 'order', 'kitchen']) {
      expect(isBlockedWrite(role, 'POST', '/orders/abc/checkout')).toBe(false);
      expect(isBlockedWrite(role, 'DELETE', '/menu/xyz')).toBe(false);
    }
    // chưa gán role thì JwtAuthGuard đã chặn từ trước, hàm này không phải nơi xử lý
    expect(isBlockedWrite(null, 'POST', '/orders/abc/checkout')).toBe(false);
    expect(isBlockedWrite(undefined, 'POST', '/orders/abc/checkout')).toBe(false);
  });
});
