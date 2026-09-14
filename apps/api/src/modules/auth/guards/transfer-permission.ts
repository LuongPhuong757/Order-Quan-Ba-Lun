// Chốt chặn công tắc "được thu chuyển khoản" (2026-09-14).
//
// Một hàm dùng chung thay vì lặp `if` ở bốn nơi: quên một chỗ thì công tắc thành trang trí, mà
// chỗ bị quên sẽ là chỗ không ai thử tay.
//
// Vì sao là hàm chứ không phải một Guard: hai trong bốn đường gọi nó có điều kiện — `checkout`
// chỉ chặn khi ĐƠN CÓ tiền chuyển khoản (thu tiền mặt thì ai cũng thu được), còn guard thì chặn
// cả route.
import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Ném 403 nếu người đang đăng nhập không được thu chuyển khoản.
 *
 * Mã lỗi RIÊNG và KHÔNG đưa vào dict `FRIENDLY_VN` của `global-exception.filter.ts` — cùng lệ với
 * `TRANSFER_EXCEEDS_TOTAL` và 9 mã đặt hàng online: câu này phải CHỈ ĐƯỜNG chứ không chỉ báo lỗi.
 *
 * Vì sao câu chữ quan trọng đến thế: có một khe hẹp không đóng được bằng code — chủ quán tắt công
 * tắc đúng lúc nhân viên đang giơ QR và khách vừa quét xong. Tiền ĐÃ vào tài khoản, mà app từ
 * chối ghi nhận. Người đứng đó cần biết ngay phải làm gì (nhờ quản lý thu hộ), không phải đọc
 * "bạn không có quyền" rồi tự xoay.
 */
export function assertCanCollectTransfer(req: Request, message?: string): void {
  if (req.user?.can_collect_transfer) return;
  throw new ForbiddenException({
    code: 'TRANSFER_NOT_ALLOWED',
    // Mặc định là câu của LÚC ĐANG THU TIỀN — trường hợp gấp gáp nhất. Đường nào không phải thu
    // tiền (xem lại ảnh bill chẳng hạn) thì truyền câu riêng: bảo người ta "nhờ quản lý thu hộ
    // bàn này" trong lúc họ chỉ đang mở màn Lịch sử là một câu vô nghĩa.
    message: message ?? 'Bạn không được thu chuyển khoản. Nhờ quản lý thu hộ bàn này.',
  });
}
