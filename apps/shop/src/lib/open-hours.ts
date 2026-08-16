import type { OpenHourRule } from '@order/schemas';

/**
 * "Quán mở lại lúc …" — suy ra từ `open_hours` mà `GET /api/public/store` vốn đã trả về
 * (2026-08-06).
 *
 * Vì sao cần: banner lúc quán đóng cửa chỉ có câu chủ quán tự soạn ("cứ đặt, chúng tôi xử lý sớm
 * nhất"). Khách đọc xong vẫn không biết "sớm nhất" là 20 phút hay 9 tiếng, nên hoặc họ gọi điện
 * hỏi, hoặc bỏ đi. Giờ mở cửa thì đã nằm sẵn trong payload từ phase 8, chưa ai dùng.
 *
 * ── 2 ranh giới ──
 * 1. **Chỉ dùng cho `blocking_reason === 'OUTSIDE_HOURS'`.** Quán tắt nhận đơn BẰNG TAY thì mốc mở
 *    lại nằm ở `online_ordering_off_until_ms`, và mốc đó KHÔNG công khai — đoán theo giờ mở cửa là
 *    hứa một giờ quán chưa hứa. Chỗ gọi phải tự kiểm điều kiện này.
 * 2. **Không thay câu của chủ quán, chỉ thêm một dòng.** Câu họ soạn là nguyên văn (D-14).
 *
 * Giờ tính theo ICT (+7) cố định, KHÔNG theo múi giờ máy khách: `open_hours` là giờ Việt Nam, và
 * khách mở web từ nước ngoài (Việt kiều đặt hộ nhà) thì máy họ lệch 7-14 tiếng. Cùng cách cộng
 * offset thủ công như `store-status.ts` phía BE — nguồn sự thật của luật giờ mở cửa.
 *
 * Module thuần: `nowMs` luôn là tham số, không đọc `Date.now()` bên trong (test không cần fake timer).
 */

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Thứ trong tuần theo cách gọi tiếng Việt — index = `dow` của `OpenHourRule` (0 = Chủ Nhật). */
const DOW_LABELS = [
  'Chủ Nhật',
  'Thứ Hai',
  'Thứ Ba',
  'Thứ Tư',
  'Thứ Năm',
  'Thứ Sáu',
  'Thứ Bảy',
] as const;

/** "07:30" → 450. Chuỗi rác trả `null` để chỗ gọi bỏ qua rule đó thay vì tính ra NaN. */
function toMinutes(hhmm: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/**
 * Câu "Quán mở lại lúc …" cho lần mở cửa GẦN NHẤT trong 7 ngày tới, hoặc `null` khi không nói
 * được gì chắc chắn (chưa cấu hình giờ, hoặc cả tuần không có rule đọc được).
 *
 * `null` là kết quả hợp lệ và khá thường gặp — `open_hours` mặc định là `[]` (quán mới cài, nghĩa
 * là "không giới hạn giờ"). Chỗ gọi phải chịu được `null` và đơn giản là không hiện dòng nào.
 */
export function nextOpeningText(openHours: OpenHourRule[], nowMs: number): string | null {
  const found = findNextOpening(openHours, nowMs);
  if (!found) return null;
  const { dayOffset, dow, clock } = found;
  if (dayOffset === 0) return `Quán mở lại lúc ${clock} hôm nay.`;
  if (dayOffset === 1) return `Quán mở lại lúc ${clock} sáng mai.`;
  return `Quán mở lại ${DOW_LABELS[dow]} lúc ${clock}.`;
}

/**
 * MỐC epoch ms của lần mở cửa gần nhất — cho đồng hồ đếm ngược ở nút đặt đơn (2026-08-16).
 * Cùng một vòng quét với `nextOpeningText` (tách chung thành `findNextOpening`): câu chữ và con
 * số đếm ngược mà tính bằng hai đường riêng thì sớm muộn banner nói "mở lúc 07:30" trong khi
 * đồng hồ đếm về một giờ khác.
 *
 * `nowMs` NÊN là giờ server đã hiệu chỉnh (xem `server_now_ms` của `GET /api/public/store`) —
 * hàm này thuần tuý tin `nowMs` được đưa vào, việc hiệu chỉnh là của chỗ gọi.
 */
export function nextOpeningMs(openHours: OpenHourRule[], nowMs: number): number | null {
  const found = findNextOpening(openHours, nowMs);
  if (!found) return null;
  // Nửa đêm ICT của "hôm nay" (theo lịch VN), cộng offset ngày + phút mở cửa, rồi trừ ngược
  // về epoch thật. Cùng kiểu số học +7 cố định như mọi hàm trong file.
  const vnDate = new Date(nowMs + VN_OFFSET_MS);
  const vnMidnightShifted = Date.UTC(vnDate.getUTCFullYear(), vnDate.getUTCMonth(), vnDate.getUTCDate());
  return vnMidnightShifted + found.dayOffset * DAY_MS + found.fromMinutes * 60_000 - VN_OFFSET_MS;
}

/** Vòng quét 7 ngày dùng chung cho câu chữ + mốc đếm ngược — xem docblock `nextOpeningMs`. */
function findNextOpening(
  openHours: OpenHourRule[],
  nowMs: number,
): { dayOffset: number; dow: number; fromMinutes: number; clock: string } | null {
  if (openHours.length === 0) return null;

  const vnDate = new Date(nowMs + VN_OFFSET_MS);
  const todayDow = vnDate.getUTCDay();
  const nowMinutes = vnDate.getUTCHours() * 60 + vnDate.getUTCMinutes();

  // 0 = hôm nay (chỉ tính nếu giờ mở còn ở phía trước), tới 7 = đúng hôm nay tuần sau.
  for (let offset = 0; offset <= 7; offset += 1) {
    const dow = (todayDow + offset) % 7;
    const rule = openHours.find((r) => r.dow === dow);
    if (!rule) continue; // Nghỉ ngày đó.

    const from = toMinutes(rule.from);
    const to = toMinutes(rule.to);
    if (from === null || to === null || from >= to) continue; // Rule hỏng — bỏ, đừng đoán.
    if (offset === 0 && nowMinutes >= from) continue; // Hôm nay đã qua giờ mở.

    return { dayOffset: offset, dow, fromMinutes: from, clock: rule.from.trim() };
  }

  return null;
}

/** Đúng hôm nay quán mở mấy giờ tới mấy giờ — dùng cho dòng phụ ở footer/banner khi cần.
 *  `null` khi hôm nay nghỉ hoặc chưa cấu hình. */
export function todayOpenRange(openHours: OpenHourRule[], nowMs: number): string | null {
  if (openHours.length === 0) return null;
  const dow = new Date(nowMs + VN_OFFSET_MS).getUTCDay();
  const rule = openHours.find((r) => r.dow === dow);
  if (!rule) return null;
  if (toMinutes(rule.from) === null || toMinutes(rule.to) === null) return null;
  return `${rule.from.trim()} – ${rule.to.trim()}`;
}

/** Đưa ra ngoài để test khỏi tự tính lại offset ICT khi dựng mốc thời gian. */
export const ICT_OFFSET_MS = VN_OFFSET_MS;
export const MS_PER_DAY = DAY_MS;
