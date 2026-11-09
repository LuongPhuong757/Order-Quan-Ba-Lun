// Thanh chuyển trang của các bảng cắt trang Ở CLIENT (màn Nhà cung cấp, Món bán…) — nhận thẳng
// `TrangKetQua` của `phanTrang()` cho gọn chỗ gọi.
//
// Từ 2026-11-09 chỉ còn là lớp bọc mỏng của `ui/Pagination` (thanh chung toàn hệ thống: dãy số +
// lưới chọn trang). Giữ lại tên cũ để 6 chỗ gọi không phải sửa.
//
// Ẩn hẳn khi chỉ có MỘT trang — `Pagination` tự lo.
import type { TrangKetQua } from '../lib/supplier-stats.ts';
import { Pagination } from './ui/Pagination.tsx';

export function Pager<T>({
  trang,
  doiTrang,
  nhan,
}: {
  trang: TrangKetQua<T>;
  doiTrang: (n: number) => void;
  /** Tên thứ đang đếm, số ít — "phiếu", "mặt hàng". Hiện ở dòng "Trang 2 / 5 · 93 phiếu". */
  nhan: string;
}) {
  return (
    <Pagination
      page={trang.page}
      totalPages={trang.totalPages}
      onChange={doiTrang}
      total={trang.total}
      donVi={nhan}
    />
  );
}
