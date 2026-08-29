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

/** "07:30" → 450. Chuỗi rác trả `null` để chỗ gọi bỏ qua rule đó thay vì tính ra NaN.
 *  Giờ ĐÓNG chạy tiếp qua 24:00 cho ca đêm: "26:00" = 1560 = 2h sáng hôm sau (2026-08-30, nới từ
 *  mốc "24:00 = hết ngày" của 2026-08-16). Trần 30:00 khớp `HHMM_TO` ở settings.controller —
 *  nới rộng hơn BE thì shop sẽ vẽ ra một giờ mà BE không bao giờ lưu nổi. */
const MAX_CLOSE_MINUTES = 30 * 60;

function toMinutes(hhmm: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (m > 59) return null;
  const total = h * 60 + m;
  return total > MAX_CLOSE_MINUTES ? null : total;
}

/** 1560 → "02:00". Chỉ để HIỂN THỊ: khách đọc "quán bán tới 26:00" thì phải tự trừ trong đầu. */
function formatClock(minutes: number): string {
  const wrapped = minutes % (24 * 60);
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
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

    // Một ngày có thể có nhiều khoảng (2026-08-30). Lấy khoảng mở SỚM NHẤT còn ở phía trước —
    // `find` khoảng đầu tiên là sai ngay khi quán nghỉ trưa: 11h trưa mà đếm ngược tới ca sáng
    // 06:00 đã qua, thay vì tới ca chiều 17:00 sắp mở.
    const candidates = openHours
      .filter((r) => r.dow === dow)
      .map((r) => ({ from: toMinutes(r.from), to: toMinutes(r.to), clock: r.from.trim() }))
      // Rule hỏng — bỏ, đừng đoán.
      .filter((r): r is { from: number; to: number; clock: string } =>
        r.from !== null && r.to !== null && r.from < r.to)
      .filter((r) => offset > 0 || nowMinutes < r.from) // Hôm nay: chỉ khoảng chưa tới giờ mở.
      .sort((a, b) => a.from - b.from);

    const next = candidates[0];
    if (next) return { dayOffset: offset, dow, fromMinutes: next.from, clock: next.clock };
  }

  return null;
}

/** Đúng hôm nay quán mở mấy giờ tới mấy giờ — dùng cho dòng phụ ở footer/banner khi cần.
 *  `null` khi hôm nay nghỉ hoặc chưa cấu hình. */
export function todayOpenRange(openHours: OpenHourRule[], nowMs: number): string | null {
  if (openHours.length === 0) return null;
  const dow = new Date(nowMs + VN_OFFSET_MS).getUTCDay();
  const spans = openHours
    .filter((r) => r.dow === dow)
    .map((r) => ({ from: toMinutes(r.from), to: toMinutes(r.to) }))
    .filter((r): r is { from: number; to: number } => r.from !== null && r.to !== null)
    .sort((a, b) => a.from - b.from);
  if (spans.length === 0) return null; // Hôm nay nghỉ.
  // Nhiều khoảng thì liệt kê hết: "06:00 – 10:00, 17:00 – 02:00 (hôm sau)". Chỉ hiện khoảng đầu
  // là nói với khách rằng quán đóng cửa từ 10h sáng.
  return spans.map((s) => formatSpan(s.from, s.to)).join(', ');
}

function formatSpan(from: number, to: number): string {
  // Ca vắt qua nửa đêm phải nói rõ "hôm sau": "16:00 – 02:00" trần trụi đọc như quán mở 10 tiếng
  // buổi sáng rồi đóng lúc trưa.
  //
  // Đúng 24:00 giữ nguyên chữ "24:00" như từ 2026-08-16: "00:00 (hôm sau)" đúng về nghĩa nhưng
  // rối hơn hẳn cho cái nó muốn nói, là "mở tới hết ngày".
  if (to === 24 * 60) return `${formatClock(from)} – 24:00`;
  const suffix = to > 24 * 60 ? ' (hôm sau)' : '';
  return `${formatClock(from)} – ${formatClock(to)}${suffix}`;
}

/** Đưa ra ngoài để test khỏi tự tính lại offset ICT khi dựng mốc thời gian. */
export const ICT_OFFSET_MS = VN_OFFSET_MS;
export const MS_PER_DAY = DAY_MS;
