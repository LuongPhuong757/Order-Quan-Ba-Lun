// Module thuần: không import gì từ @nestjs/* hay typeorm.
//
// Nguồn gốc: `OrdersService.runWithRetry` (Milestone 1, private method) — tách ra ở
// phase 9 để `AdminOnlineOrdersService` (cấp bàn khi duyệt đơn online, M2.D-06) dùng
// chung, không phải chép lại 18 dòng logic deadlock retry. Sửa regex ở đây là đổi hành
// vi của cả 2 luồng transaction quan trọng nhất hệ thống (mở đơn tại bàn + cấp bàn cho
// đơn online) — đụng vào file này phải chạy lại full suite của cả 2 service.

/** Nhận diện lỗi transient của MySQL2/TypeORM (deadlock / lock wait timeout / mã lỗi
 * ER_LOCK_*). Giữ NGUYÊN regex cũ từ OrdersService: nó đã được chỉnh khớp đúng message
 * MySQL2/TypeORM thật trong repo này — không thay bằng thư viện ngoài (vd `p-retry`). */
export function isTransientDbError(err: unknown): boolean {
  const msg = (err as { message?: string })?.message ?? '';
  return /deadlock|lock wait timeout|ER_LOCK/i.test(msg);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry helper dùng chung — chạy lại 1-2 lần khi gặp transient DB error (deadlock, lock
 * timeout). Sleep ngắn ngẫu nhiên giữa các lần để giảm collision. Lỗi khác ném ngay,
 * không nuốt. */
export async function runWithRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number,
  opts?: {
    onRetry?: (attempt: number, message: string) => void;
    sleepFn?: (ms: number) => Promise<void>;
  },
): Promise<T> {
  const sleepFn = opts?.sleepFn ?? defaultSleep;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = (err as { message?: string })?.message ?? '';
      const isTransient = isTransientDbError(err);
      if (!isTransient || attempt === maxAttempts) throw err;
      opts?.onRetry?.(attempt, msg);
      await sleepFn(30 + Math.random() * 70);
    }
  }
  throw lastErr;
}
