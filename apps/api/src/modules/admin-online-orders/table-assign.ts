// Module thuần: không import gì từ @nestjs/* hay typeorm.
//
// Hàm này KHÔNG tự quyết bàn nào đang bận — đó là việc của câu `FOR UPDATE` trong
// transaction (plan 09-06, cấp bàn khi duyệt đơn online, M2.D-06). Ở đây chỉ có 2 quy
// tắc thuần: sắp xếp "bàn nhỏ nhất trước" (M2.D-04) và đặt tên bàn mới khi hết bàn
// trống (M2.D-05) — cả 2 đều test được mà không cần DB.

import { KIND_FORMAT, formatTableCode, kindForFulfillment } from '../tables/table-kind.js';

export type FreeTableCandidate = { id: string; code: string; name: string };

/** Chọn bàn trống nhỏ nhất trước (M2.D-04): sắp `code` ASC rồi trả phần tử đầu.
 * Service sẽ đã `ORDER BY code ASC LIMIT 1 FOR UPDATE` ở SQL — hàm này là lưới an
 * toàn thứ hai + chỗ để test quy tắc mà không cần DB. Rỗng → null (gợi ý cho service:
 * phải tự tạo bàn mới). */
export function pickFreeTable(candidates: FreeTableCandidate[]): FreeTableCandidate | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => a.code.localeCompare(b.code));
  return sorted[0];
}

/** Sinh code bàn kế tiếp cho 1 kind khi không còn bàn trống (M2.D-05). Lọc các code
 * khớp đúng tiền tố của kind (`^{codePrefix}-(\d+)$`), lấy số lớn nhất rồi +1. Không có
 * code nào khớp → số 1. So sánh theo SỐ (không theo chuỗi) để tránh bug so chuỗi
 * (vd hậu tố "-9" bị coi lớn hơn "-10" nếu so ký tự thay vì so giá trị số). */
export function nextTableCode(kind: string, existingCodes: string[]): string {
  const fmt = KIND_FORMAT[kind];
  if (!fmt) throw new Error(`kind không hợp lệ: ${kind}`);
  const pattern = new RegExp(`^${escapeRegExp(fmt.codePrefix)}-(\\d+)$`);
  let maxNum = 0;
  for (const code of existingCodes) {
    const m = pattern.exec(code);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > maxNum) maxNum = n;
  }
  return formatTableCode(kind, maxNum + 1);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Re-export để plan 09-06 chỉ cần import 1 chỗ (KHÔNG chép lại logic map).
export { kindForFulfillment };
