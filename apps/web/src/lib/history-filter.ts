// Bộ lọc của màn Lịch sử (/history), dựng thành query string.
//
// VÌ SAO PHẢI GOM VỀ ĐÂY: một màn, một bộ lọc, nhưng BA endpoint đọc nó —
// `/orders/history` (danh sách đơn), `/orders/stats` (biểu đồ + 2 ô tổng quan) và
// `/consumption` (bảng tiêu hao). Trước đây mỗi endpoint tự dựng `URLSearchParams` bằng một
// khối code chép tay trong `HistoryPage.tsx`, và ba bản chép đó đã lệch nhau thật:
// khoảng ngày tính bằng `new Date(iso + 'T00:00:00')` — tức múi giờ CỦA MÁY — trong khi cả
// `lib/date-range.ts` chốt mọi ngày theo giờ VN. Ba bản chép nghĩa là sửa một chỗ thì hai chỗ
// kia vẫn sai, và không có gì trên màn hình nói ra là chúng đang hỏi hai khoảng khác nhau.
//
// Ở đây là hàm THUẦN, không gọi mạng: nó là phần duy nhất của màn đó kiểm được bằng test.

import { vnDayEndMs, vnDayStartMs } from './date-range.ts';

export type HistoryStatus = 'all' | 'paid' | 'unpaid' | 'cancelled';
export type HistoryMisa = '' | 'pending' | 'copied';

export type HistoryFilters = {
  table_id: string;
  cashier_user_id: string;
  status: HistoryStatus;
  misa: HistoryMisa;
  /** Khoảng ngày 'YYYY-MM-DD' theo giờ VN. Chuỗi rỗng = không chặn đầu đó. */
  from: string;
  to: string;
};

export type HistoryQueryOpts = {
  /** `false` cho `/consumption`: nguyên liệu tốn theo món khách ăn, không theo ai đứng thu
   *  tiền — endpoint đó không nhận `cashier_user_id`. */
  cashier?: boolean;
  /** Chỉ `/orders/history` phân trang. Biểu đồ CỐ Ý không theo trang: bảng số nói về cả bộ
   *  lọc, không phải 20 dòng đang xem. */
  page?: { page: number; page_size: number };
};

export function historyQuery(f: HistoryFilters, opts: HistoryQueryOpts = {}): URLSearchParams {
  const q = new URLSearchParams();
  if (f.table_id) q.set('table_id', f.table_id);
  if (opts.cashier !== false && f.cashier_user_id) q.set('cashier_user_id', f.cashier_user_id);
  if (f.status !== 'all') q.set('status', f.status);
  if (f.misa) q.set('misa', f.misa);
  if (f.from) q.set('start_ms', String(vnDayStartMs(f.from)));
  if (f.to) q.set('end_ms', String(vnDayEndMs(f.to)));
  if (opts.page) {
    q.set('page', String(opts.page.page));
    q.set('page_size', String(opts.page.page_size));
  }
  return q;
}

/**
 * Khoá định danh của bộ lọc — hai bộ lọc cho ra cùng khoá thì hỏi API cùng một câu.
 *
 * Dùng làm deps của effect: đổi `page` KHÔNG được bắt biểu đồ tải lại (biểu đồ không theo
 * trang), nhưng đổi bất cứ trục lọc nào thì phải.
 */
export function historyFilterKey(f: HistoryFilters): string {
  return historyQuery(f).toString();
}
