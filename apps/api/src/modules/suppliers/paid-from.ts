// Tài khoản nguồn của một lần trả NCC (2026-10-15, chủ quán yêu cầu).
//
// Trả bằng CHUYỂN KHOẢN thì BẮT BUỘC nói tiền đi từ tài khoản nào của quán — đó là thứ biểu đồ
// "tiền vào / tiền ra theo tài khoản" ở tab Thống kê cộng lên. Một lần CK không có tài khoản là
// một khoản ra không rơi vào cột nào, và tổng chi của các tài khoản sẽ không khớp tổng đã trả.
//
// Hàm thuần để test được mà không cần DB: service đọc mã QR rồi đưa vào đây.
import { BadRequestException } from '@nestjs/common';
import type { PaymentMethod } from './entities/supplier-payment.entity.js';

export type QrAccountLite = { id: string; label: string; is_active: boolean };

export type PaidFrom = { paid_from_account_id: string | null; paid_from_label: string | null };

/**
 * @param account mã QR đọc theo `accountId` (null = không tìm thấy hoặc không truyền).
 * @param giuNguyen lần SỬA mà vẫn giữ đúng tài khoản cũ → giữ nhãn cũ, KHÔNG đòi mã còn bật.
 *   Mã QR tắt hay xoá sau khi đã chi thì khoản chi cũ vẫn là chi từ tài khoản đó; bắt người sửa
 *   ghi chú một dòng tháng trước phải chọn lại tài khoản là ép họ khai sai.
 */
export function resolvePaidFrom(
  method: PaymentMethod,
  accountId: string | null | undefined,
  account: QrAccountLite | null,
  giuNguyen?: { paid_from_account_id: string | null; paid_from_label: string | null },
): PaidFrom {
  // Tiền mặt không đi qua tài khoản nào — xoá sạch, kể cả khi màn gửi kèm id (đổi CK → tiền mặt).
  if (method !== 'TRANSFER') return { paid_from_account_id: null, paid_from_label: null };

  if (!accountId) {
    throw new BadRequestException({
      code: 'PAID_FROM_REQUIRED',
      message: 'Chuyển khoản thì phải chọn tiền đi từ tài khoản nào.',
    });
  }
  if (giuNguyen && giuNguyen.paid_from_account_id === accountId) {
    return { paid_from_account_id: accountId, paid_from_label: account?.label ?? giuNguyen.paid_from_label };
  }
  if (!account || !account.is_active) {
    throw new BadRequestException({
      code: 'PAID_FROM_INVALID',
      message: 'Tài khoản đã chọn không còn dùng. Chọn lại tài khoản khác.',
    });
  }
  return { paid_from_account_id: account.id, paid_from_label: account.label };
}
