// Hạn mức tiền chuyển khoản vào mã QR HKD mỗi ca (chủ quán chốt 2026-11-20).
//
// Mục đích: giữ doanh thu hộ kinh doanh dưới ngưỡng thuế. Luật đã chốt:
//   - Ca = 12h trưa → 12h trưa hôm sau (giờ VN), CÙNG mốc với chip "Ca này" ở FE
//     (`apps/web/src/lib/date-range.ts` → `shiftStartMs`). Đổi giờ ở đây thì đổi cả bên kia.
//   - Tính theo giờ THU TIỀN: `COALESCE(debt_paid_at, closed_at)` — thu nợ cũ bằng mã HKD tính
//     vào ca lúc thu, không phải ca phát sinh nợ.
//   - Cộng CHUNG mọi mã có cờ `is_hkd`: ngưỡng thuế tính theo hộ kinh doanh, không theo tài khoản.
//   - Đếm theo đơn trong app (chủ quán chọn), không theo webhook ngân hàng.
//   - Đơn huỷ / chuyển sang nợ có `is_paid = 0` → rơi khỏi PAID_SQL → tự nhả hạn mức.
//   - Trần là TỐI ĐA: đủ đúng 6.000.000 vẫn được, 6.000.001 thì chặn. Không ai được vượt.
import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { HKD_SQL } from './hkd-sql.js';

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
const VN_OFFSET_MS = 7 * HOUR_MS;
/** Giờ đổi ca. PHẢI khớp `SHIFT_START_HOUR` ở FE. */
export const HKD_SHIFT_START_HOUR = 12;

export type HkdCapConfig = { enabled: boolean; cap: number; warn: number };

/** Mốc mở ca (epoch ms) chứa thời điểm `nowMs`. VN không có DST nên cộng/trừ thẳng là đúng. */
export function hkdShiftStartMs(nowMs: number): number {
  const sinceShift = (nowMs + VN_OFFSET_MS - HKD_SHIFT_START_HOUR * HOUR_MS) % DAY_MS;
  return nowMs - (sinceShift < 0 ? sinceShift + DAY_MS : sinceShift);
}

/** Câu chặn — KHÔNG có số tiền: nhân viên Order/Bếp không được thấy doanh thu (chủ quán chốt
 *  2026-10-20). Chủ quán xem con số ở dải trong hộp thu tiền. */
export const HKD_CAP_BLOCK = 'Mã HKD không còn đủ hạn mức ca này cho đơn này — chọn mã QR khác';

/** `true` = thu thêm `amount` vào HKD sẽ vượt trần. Hàm thuần để test. */
export function exceedsHkdCap(used: number, amount: number, cap: number): boolean {
  return used + amount > cap;
}

/** Tổng tiền chuyển khoản vào mã HKD của ca đang chạy (trừ đơn `excludeOrderId`). */
export async function hkdShiftUsed(
  runner: Pick<EntityManager, 'query'>,
  nowMs: number,
  excludeOrderId?: string,
): Promise<number> {
  const rows: Array<{ used: string | number | null }> = await runner.query(
    `SELECT COALESCE(SUM(o.transfer_amount), 0) AS used FROM orders o
      WHERE o.closed_at IS NOT NULL AND o.is_paid = 1 AND ${HKD_SQL}
        AND COALESCE(o.debt_paid_at, o.closed_at) >= ?
        AND o.id <> ?`,
    // `new Date(...)`, KHÔNG phải số ms: cột `closed_at`/`debt_paid_at` trong DB là DATETIME(6)
    // (entity tự đổi sang ms khi đọc). So DATETIME với một số là MySQL ép kiểu kỳ quặc — đơn
    // từ 10 ngày trước vẫn lọt vào ca hôm nay (đã dính 2026-11-20). Cùng cách `orders.service`
    // lọc `start_ms`.
    [new Date(hkdShiftStartMs(nowMs)), excludeOrderId ?? ''],
  );
  return Number(rows[0]?.used ?? 0);
}

/**
 * Chặn nếu thu `amount` vào HKD làm tổng ca vượt trần. Gọi TRONG transaction thu tiền.
 *
 * KHOÁ mọi dòng mã HKD (`FOR UPDATE`) trước khi cộng: hai máy cùng thu khi chỉ còn chỗ cho một
 * đơn thì máy sau phải ĐỢI máy trước commit rồi mới đọc tổng — không khoá thì cả hai cùng thấy
 * "còn 1tr" và cùng lọt. Khoá chỉ chạm đơn thu vào HKD (đường gọi đã lọc `isHkd`), đơn tiền mặt
 * và mã khác không phải xếp hàng.
 */
export async function assertHkdCap(
  mgr: EntityManager,
  cfg: HkdCapConfig | undefined,
  amount: number,
  orderId: string,
): Promise<void> {
  if (!cfg?.enabled || amount <= 0) return;
  await mgr.query('SELECT id FROM payment_qr_accounts WHERE is_hkd = 1 FOR UPDATE');
  const used = await hkdShiftUsed(mgr, Date.now(), orderId);
  if (exceedsHkdCap(used, amount, cfg.cap)) {
    // Mã riêng, NGOÀI FRIENDLY_VN — không thì GlobalExceptionFilter ghi đè câu này.
    throw new BadRequestException({ code: 'HKD_SHIFT_CAP', message: HKD_CAP_BLOCK });
  }
}
