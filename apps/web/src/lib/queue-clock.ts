// Đồng hồ "khách đã chờ duyệt bao lâu" cho trang Hàng chờ duyệt (D-05).
//
// Module thuần: không import React, không tự đọc `Date.now()` bên trong — mọi mốc thời gian là
// tham số, nên test được không cần fake timer (khuôn `store-status.ts` của BE).
//
// ⚠ NGƯỠNG CẢNH BÁO ĐỎ LÀ THAM SỐ, KHÔNG PHẢI HẰNG SỐ TRONG FILE NÀY. Nó đến từ
// `AdminOnlineOrderList.escalate_sms_after_s` do BE trả về trong chính response hàng chờ. Chủ quán
// đổi ngưỡng ở `/admin/settings` thì màu đồng hồ phải đổi theo NGAY, không cần deploy lại FE —
// hardcode con số ở đây là làm nhân viên tin vào một ngưỡng không còn đúng (T-09-58).
//
// Cố ý KHÔNG import `item-age.ts`: file đó có ngưỡng 10/20 phút cứng và ngữ nghĩa khác (tuổi món ở
// bếp). Dùng chung sẽ khoá 2 khái niệm khác nhau vào 1 ngưỡng.

/** Số giây khách đã chờ, làm tròn xuống. Âm (lệch giờ client/server) → 0. */
export function waitingSeconds(nowMs: number, submittedAtMs: number): number {
  return Math.max(0, Math.floor((nowMs - submittedAtMs) / 1000));
}

/** `m:ss` — phút KHÔNG bị chia dư 60 (chờ 61 phút hiện `61:01`, không phải `1:01`): nhân viên cần
 * thấy ngay con số to bất thường, không phải một số nhỏ trông như bình thường. */
export function formatWait(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/** Đã tới/quá ngưỡng leo thang → hiện đỏ. Dùng `>=` vì đúng tại mốc đó SMS đã bắn: nhân viên phải
 * thấy đỏ ngay giây thứ N, không phải giây N+1. */
export function isOverdue(seconds: number, thresholdSeconds: number): boolean {
  return seconds >= thresholdSeconds;
}
