// Ai được làm gì với MỘT phiếu nhập — sau khi role Báo cáo được lập phiếu NHÁP (2026-10-23).
//
// Trước đó cả màn chỉ hỏi một câu `useCanWrite()`: admin làm hết, Báo cáo không làm gì. Giờ câu
// trả lời phụ thuộc vào TỪNG PHIẾU (của ai, đang ở trạng thái nào), nên gom về một chỗ — để
// bảng, menu `⋯` và hộp chi tiết không mỗi nơi tự suy một kiểu rồi lệch nhau.
//
// Chỉ để ẩn/hiện nút. Hàng rào thật nằm ở BE (`assertNhapCuaMinh` trong `deliveries.service.ts`).
import type { AuthUser } from './auth-context.tsx';

/** Phiếu còn chờ duyệt — chưa vào kho, chưa vào công nợ. Cùng định nghĩa với `dangChoDuyet` ở BE. */
export const dangChoDuyet = (status: string): boolean =>
  status === 'PENDING_REVIEW' || status === 'PENDING_PRICE';

export type QuyenPhieu = { sua: boolean; huy: boolean; duyet: boolean };

const KHONG: QuyenPhieu = { sua: false, huy: false, duyet: false };

export function quyenPhieu(
  user: Pick<AuthUser, 'sub' | 'role'> | null,
  d: { status: string; created_by_user_id?: string | null },
): QuyenPhieu {
  const cho = dangChoDuyet(d.status);
  if (user?.role === 'admin') {
    // Phiếu đã huỷ không sửa được (BE chặn) — bày nút ra chỉ để người ta bấm rồi ăn lỗi.
    return { sua: d.status !== 'CANCELLED', huy: cho, duyet: cho };
  }
  if (user?.role === 'report') {
    // Người lập nháp: chỉ phiếu nháp CỦA MÌNH, và không bao giờ được duyệt.
    const cuaMinh = cho && !!d.created_by_user_id && d.created_by_user_id === user.sub;
    return { sua: cuaMinh, huy: cuaMinh, duyet: false };
  }
  return KHONG;
}

/** Role này lập phiếu NHÁP thay vì phiếu vào sổ ngay. */
export const laNguoiLapNhap = (user: Pick<AuthUser, 'role'> | null): boolean => user?.role === 'report';
