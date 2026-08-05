// Tìm đơn trong màn quản lý đơn online: theo TÊN KHÁCH, SĐT, hoặc TÊN MÓN trong đơn.
// Khớp chuỗi con bỏ dấu (dùng chung `normalizeVi` với tìm món) — KHÔNG dùng khớp viết tắt
// kiểu `menuSearchScore`: tên người và SĐT không có "mã món" hay quy luật từ để viết tắt,
// khớp mờ ở đây chỉ sinh kết quả lạ khiến nhân viên nghi ngờ ô tìm kiếm.
//
// KHÔNG chấm điểm / sắp xếp lại: thứ tự danh sách đơn là thứ tự nghiệp vụ (FIFO ở hàng chờ,
// mới-nhất-trước ở tab tra cứu) — tìm kiếm chỉ THU HẸP, không được xáo trộn.

import { normalizeVi } from './menu-search.ts';

export type OrderSearchTarget = {
  customer_name: string;
  customer_phone: string;
  items: Array<{ name: string }>;
};

/** SĐT so theo CHỮ SỐ trần — '0912 345 678' hay '0912.345.678' đều tìm được bằng '345678'. */
const digitsOnly = (s: string) => s.replace(/\D/g, '');

/** MỌI token của câu tìm phải khớp ÍT NHẤT MỘT trường (AND giữa token, OR giữa trường) —
 * cùng ngữ nghĩa AND-token với tìm món. Vd: 'lan khoai' = khách tên Lan VÀ đơn có món khoai. */
export function orderMatchesSearch(row: OrderSearchTarget, query: string): boolean {
  const tokens = normalizeVi(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;

  const name = normalizeVi(row.customer_name);
  const phone = digitsOnly(row.customer_phone);
  const itemNames = row.items.map((i) => normalizeVi(i.name));

  return tokens.every((t) => {
    if (name.includes(t)) return true;
    if (itemNames.some((n) => n.includes(t))) return true;
    const d = digitsOnly(t);
    return d !== '' && phone.includes(d);
  });
}

/** Query rỗng → trả nguyên mảng (cùng reference, tránh re-render thừa). */
export function filterOrdersBySearch<T extends OrderSearchTarget>(rows: T[], query: string): T[] {
  if (!query.trim()) return rows;
  return rows.filter((r) => orderMatchesSearch(r, query));
}
