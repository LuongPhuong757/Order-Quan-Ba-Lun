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

/** Backoff mặc định — GIỮ NGUYÊN từ `OrdersService`: 30-100ms phẳng. Đủ cho tranh chấp lẻ tẻ
 * giữa vài nhân viên trong quán (mở đơn tại bàn, cấp bàn khi duyệt). */
export function flatBackoffMs(): number {
  return 30 + Math.random() * 70;
}

/** Backoff luỹ thừa có jitter — cho luồng CÔNG KHAI, nơi hàng chục khách có thể bấm cùng một
 * giây (đo được 2026-08-07: 100 đơn đồng thời → 90% deadlock).
 *
 * Vì sao không dùng backoff phẳng ở đó: 90 transaction cùng ngủ trong một cửa sổ 70ms rồi cùng
 * thức dậy là tái va chạm gần như nguyên vẹn — retry chỉ dời deadlock đi 70ms chứ không gỡ.
 * Cửa sổ phải GIÃN RA theo từng lần thử thì đám đông mới tãi ra được:
 *   lần 1 → 20-80ms · lần 2 → 40-160ms · lần 3 → 80-320ms · lần 4 → 160-640ms */
export function expBackoffMs(attempt: number): number {
  const base = 40 * 2 ** (attempt - 1);
  return base * (0.5 + Math.random());
}

/** Retry helper dùng chung — chạy lại khi gặp transient DB error (deadlock, lock timeout).
 * Sleep ngắn ngẫu nhiên giữa các lần để giảm collision. Lỗi khác ném ngay, không nuốt.
 *
 * `backoffMs` mặc định là `flatBackoffMs` — ĐỪNG đổi mặc định này: 2 call site cũ
 * (`OrdersService.getOrCreateOpenOrder`, `AdminOnlineOrdersService.confirm`) dựa vào nó và
 * đổi ở đây là đổi hành vi của cả hai mà không ai thấy. Luồng nào cần khác thì truyền vào. */
export async function runWithRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number,
  opts?: {
    onRetry?: (attempt: number, message: string) => void;
    sleepFn?: (ms: number) => Promise<void>;
    backoffMs?: (attempt: number) => number;
  },
): Promise<T> {
  const sleepFn = opts?.sleepFn ?? defaultSleep;
  const backoffMs = opts?.backoffMs ?? flatBackoffMs;
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
      await sleepFn(backoffMs(attempt));
    }
  }
  throw lastErr;
}
