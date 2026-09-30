import { describe, expect, it } from 'vitest';
import { nhanTrangThai } from './DishSalesScreen.tsx';

describe('nhanTrangThai', () => {
  it('có nhãn cho MỌI trạng thái backend trả về', () => {
    // Danh sách này phải khớp `DishOrderRow.status` ở `dish-sales.service.ts`. Thêm trạng thái
    // mới ở BE mà quên FE thì test này đỏ — trước đây không có ai canh, nên `debt` lọt suốt 5
    // ngày và làm trắng trang mỗi lần mở chi tiết một món từng nằm trong đơn ghi nợ.
    for (const status of ['paid', 'unpaid', 'cancelled', 'debt']) {
      const st = nhanTrangThai(status);
      // KHÔNG dùng `toBeTruthy()`: lớp chắn fallback trả về chính mã trạng thái nên nhãn nào
      // cũng "truthy", và test sẽ xanh y hệt khi thiếu khai báo — đúng thứ nó phải bắt. Dấu hiệu
      // thật của "có khai báo" là nhãn ĐÃ ĐƯỢC DỊCH và badge không phải màu xám dự phòng.
      expect(st.nhan, `'${status}' chưa có nhãn tiếng Việt`).not.toBe(status);
      expect(st.badge, `'${status}' đang rơi vào badge dự phòng`).not.toBe('badge--neutral');
    }
  });

  it('trạng thái lạ vẫn trả về nhãn, không trả undefined', () => {
    // Đây là lớp chắn cuối: chỗ gọi đọc `.badge` ngay, nên `undefined` ở đây là trắng cả màn.
    const st = nhanTrangThai('mot_trang_thai_chua_ton_tai');
    expect(st.badge).toBe('badge--neutral');
    expect(st.nhan).toBe('mot_trang_thai_chua_ton_tai');
  });

  it('gọi đúng tên "Đang nợ" như màn Lịch sử', () => {
    expect(nhanTrangThai('debt').nhan).toContain('Đang nợ');
  });
});
