// Nguồn: M2.D-17 (Ingest CONTEXT), M2.D-28, M2.D-30 — pure function, KHÔNG import DataSource.
// Module thuần: không import gì từ @nestjs/* hay typeorm, để test được mà không dựng app/DB.
//
// D-17: "Đóng cửa đến hết hôm nay" và "ngoài giờ mở cửa" đều TÍNH LÚC ĐỌC, không dùng cron.
// Hàm này KHÔNG mutate settings khi tự-động hết hạn (không ghi lại DB) — đúng nghĩa
// "tính lúc đọc". `nowMs` LUÔN là tham số — TUYỆT ĐỐI không đọc giờ hệ thống bên trong
// (ràng buộc của 08-VALIDATION.md, để test được auto-revert qua 00:00 mà không cần fake timer).
//
// ── ⚠ D-11 (phase 9) ĐỔI NGỮ NGHĨA, KHÔNG ĐỔI LOGIC ──
// `enabled === false` nay có nghĩa **"quán đang Đóng cửa — VẪN NHẬN ĐƠN, chỉ đổi chữ hiển thị"**.
// Nó KHÔNG còn có nghĩa "chặn submit": `order-guard.ts` đã gỡ hẳn nhánh chặn công tắc, và
// `submitOrder` không còn đọc hàm này nữa. Nơi duy nhất còn đọc là `GET /api/public/store` (để
// trang khách chọn giữa câu bình thường và `closed_banner_text`) và `/admin/settings`.
// Cơ chế tính-lúc-đọc của OD-07 giữ nguyên từng dòng — `store-status.test.ts` (16 test) phải xanh
// y nguyên sau plan 09-12, không sửa file test đó.
// D-11 ghi đè M2.D-26/M2.D-27 — vết ghi ở `OVERRIDE-DEBT.md` **OD-13**.

// ICT (UTC+7) cố định quanh năm, không có giờ mùa hè (xem Sources trong 08-RESEARCH.md)
// → không cần thư viện timezone, cộng offset cố định là đủ chính xác.
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const MINUTES_PER_DAY = 24 * 60;

export type OpenHoursDow = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type OpenHourRule = { dow: OpenHoursDow; from: string; to: string }; // "HH:mm"

export type StoreOrderingSettings = {
  online_ordering_enabled: boolean;
  online_ordering_off_mode: 'MANUAL' | 'UNTIL_TOMORROW';
  online_ordering_off_reason: string;
  online_ordering_off_until_ms: number | null;
  open_hours: OpenHourRule[]; // [] = không giới hạn giờ (quán mới cài, chưa cấu hình)
};

export type OrderingStatus = {
  enabled: boolean; // false = đang Đóng cửa (VẪN nhận đơn — D-11), KHÔNG còn nghĩa "chặn submit"
  is_open_now: boolean; // riêng phần giờ mở cửa (để FE hiện banner đúng lý do)
  blocking_reason: 'MANUAL_OFF' | 'OUTSIDE_HOURS' | null;
};

export function evaluateOrderingStatus(s: StoreOrderingSettings, nowMs: number): OrderingStatus {
  // 1) Giải quyết manual OFF — bao gồm auto-revert "hết hôm nay" tính lúc đọc, KHÔNG ghi lại DB.
  let manualEnabled = s.online_ordering_enabled;
  if (!manualEnabled && s.online_ordering_off_mode === 'UNTIL_TOMORROW') {
    if (s.online_ordering_off_until_ms !== null && nowMs > s.online_ordering_off_until_ms) {
      manualEnabled = true; // Qua 00:00 → coi như đã bật lại, dù cột DB vẫn ghi false
    }
  }

  // 2) Giờ mở cửa — múi giờ Asia/Ho_Chi_Minh cố định +7, không DST.
  const isOpenNow = isWithinOpenHours(s.open_hours, nowMs);

  // 3) Manual override luôn thắng (M2.D-30): nếu manual OFF thì không cần xét giờ mở cửa nữa.
  if (!manualEnabled) {
    return { enabled: false, is_open_now: isOpenNow, blocking_reason: 'MANUAL_OFF' };
  }
  if (!isOpenNow) {
    return { enabled: false, is_open_now: false, blocking_reason: 'OUTSIDE_HOURS' };
  }
  return { enabled: true, is_open_now: true, blocking_reason: null };
}

/**
 * ── CA QUÁ NỬA ĐÊM (2026-08-30) ──
 *
 * Quán bán tới 2-3h sáng. Giờ đóng vì thế ghi bằng SỐ PHÚT TIẾP TỤC CHẠY QUA 24:00: "26:00" nghĩa
 * là 2h sáng HÔM SAU. Không dùng cách "to < from thì hiểu là qua đêm" — với cách đó `16:00–02:00`
 * và `02:00–16:00` trông giống hệt nhau trên màn hình chủ quán, và mọi phép so `from < to` rải rác
 * khắp FE/BE đều phải mọc thêm một nhánh ngoại lệ. Ghi "26:00" thì bất biến `from < to` còn đúng ở
 * mọi nơi, và "24:00" (mở tới hết ngày, có từ 2026-08-16) chỉ là một trường hợp của cùng quy ước.
 *
 * Hệ quả: lúc 01:00 thứ Ba, ca đang chạy là ca của thứ HAI. Nên phải soi HAI rule — của hôm nay,
 * và của hôm qua với mốc thời gian đẩy thêm 24h. Thiếu vế thứ hai thì đúng 00:00 quán tự khoá đặt
 * hàng giữa lúc bếp vẫn đỏ lửa.
 */
function isWithinOpenHours(openHours: OpenHourRule[], nowMs: number): boolean {
  // open_hours rỗng (chưa cấu hình, default spec §4.1) → KHÔNG giới hạn giờ, luôn mở.
  // Điều chỉnh BẮT BUỘC so với bản mẫu 08-RESEARCH.md: bản mẫu trả `false` khi không
  // tìm thấy rule, sẽ khoá toàn bộ quán mới cài vì spec §4.1 đặt default open_hours = [].
  if (openHours.length === 0) return true;

  const vnMs = nowMs + VN_OFFSET_MS;
  const vnDate = new Date(vnMs);
  const dow = vnDate.getUTCDay() as OpenHoursDow;
  const minutesNow = vnDate.getUTCHours() * 60 + vnDate.getUTCMinutes();

  // `filter` chứ không `find`: một ngày có thể có NHIỀU khoảng (2026-08-30) — vd bán sáng
  // 06:00–10:00, nghỉ trưa, rồi 17:00–29:00. `find` lấy khoảng đầu tiên và im lặng nuốt phần còn
  // lại, nghĩa là quán mở nhưng phần mềm bảo đóng.
  const today = openHours.filter((r) => r.dow === dow);
  if (today.some((r) => inRange(minutesNow, r.from, r.to))) return true;

  // Ca đêm của hôm qua còn kéo sang: 01:00 hôm nay = phút thứ 1500 tính từ 00:00 hôm qua.
  // Với rule đóng trước 24:00 thì `minutesNow + 1440 >= 1440 > to` nên vế này luôn sai — hành vi
  // của các quán đóng trong ngày không đổi một li.
  const yesterdayDow = ((dow + 6) % 7) as OpenHoursDow;
  const yesterday = openHours.filter((r) => r.dow === yesterdayDow);
  if (yesterday.some((r) => inRange(minutesNow + MINUTES_PER_DAY, r.from, r.to))) return true;

  return false;
}

function inRange(minutes: number, from: string, to: string): boolean {
  const [fh, fm] = from.split(':').map(Number);
  const [th, tm] = to.split(':').map(Number);
  return minutes >= fh * 60 + fm && minutes < th * 60 + tm;
}

// Shape "mặc định + ngoại lệ" cho D-15 (UI /admin/settings), tách khỏi shape lưu DB.
//
// ── NHIỀU KHOẢNG MỖI NGÀY (2026-08-30) ──
// Trước đây mỗi thứ đúng một khoảng, nên `open_hours` luôn có đúng 7 phần tử. Nay một thứ có thể
// có nhiều khoảng (bán sáng, nghỉ trưa, mở lại tối) hoặc KHÔNG khoảng nào (nghỉ cả ngày), nên
// `open_hours` dài ngắn tuỳ cấu hình. Cột DB không đổi kiểu — nó vốn đã là mảng `{dow, from, to}`,
// chỉ là chưa ai xếp hai dòng cùng một `dow` vào đó.
//
// ⚠ Mảng RỖNG có nghĩa "không giới hạn giờ, mở 24/24" (spec §4.1) chứ KHÔNG phải "nghỉ cả tuần".
// Nên cấu hình mà mọi ngày đều rỗng phải bị chặn ở controller — nếu lọt, chủ quán bấm "nghỉ hết"
// rồi nhận đơn suốt đêm.
const ALL_DOWS: OpenHoursDow[] = [0, 1, 2, 3, 4, 5, 6];

export type OpenHoursSpan = { from: string; to: string };

export type OpenHoursInput = {
  default: OpenHoursSpan[];
  exceptions: Array<{ dow: OpenHoursDow; spans: OpenHoursSpan[] }>;
};

export function expandToWeek(input: OpenHoursInput): OpenHourRule[] {
  const byDow = new Map(input.exceptions.map((e) => [e.dow, e.spans]));
  return ALL_DOWS.flatMap((dow) =>
    (byDow.get(dow) ?? input.default).map((span) => ({ dow, from: span.from, to: span.to })),
  );
}

/** Khoá so sánh "hai ngày có giống hệt khung giờ không". Đã sắp theo `from` nên thứ tự người dùng
 *  nhập vào không làm hai ngày giống nhau trông thành khác nhau. */
function spansKey(spans: OpenHoursSpan[]): string {
  return spans.map((s) => `${s.from}-${s.to}`).join('|');
}

function sortSpans(spans: OpenHoursSpan[]): OpenHoursSpan[] {
  return [...spans].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

// M2.D-28 — "OFF đến hết hôm nay": mốc lưu vào `online_ordering_off_until_ms` là 23:59:59.999
// giờ ICT của NGÀY ICT chứa `nowMs` (không phải ngày UTC). Tính ở BE để FE không cần biết múi
// giờ. `nowMs` LUÔN là tham số — cấm tự đọc giờ hệ thống bên trong (lý do ở đầu file).
export function endOfTodayIctMs(nowMs: number): number {
  const vnMs = nowMs + VN_OFFSET_MS;
  const vnDate = new Date(vnMs);
  const endOfDayVnMs = Date.UTC(
    vnDate.getUTCFullYear(),
    vnDate.getUTCMonth(),
    vnDate.getUTCDate(),
    23,
    59,
    59,
    999,
  );
  return endOfDayVnMs - VN_OFFSET_MS;
}

// Chiều ngược lại (đọc để hiển thị form): gom rule về từng thứ, thứ nào KHÔNG khớp khung giờ phổ
// biến nhất trong tuần → thành ngoại lệ.
//
// Quét đủ cả 7 thứ chứ không chỉ những thứ có rule: một thứ vắng mặt trong `open_hours` nghĩa là
// NGHỈ cả ngày, và form phải hiện ra được điều đó (ngoại lệ với 0 khoảng) thay vì âm thầm cho nó
// thừa hưởng khung giờ mặc định — lưu lại một phát là ngày nghỉ biến mất.
export function collapseToDefaultExceptions(rules: OpenHourRule[]): OpenHoursInput {
  const spansByDow = new Map<OpenHoursDow, OpenHoursSpan[]>(
    ALL_DOWS.map((dow) => [
      dow,
      sortSpans(rules.filter((r) => r.dow === dow).map((r) => ({ from: r.from, to: r.to }))),
    ]),
  );

  const counts = new Map<string, number>();
  for (const dow of ALL_DOWS) {
    const key = spansKey(spansByDow.get(dow)!);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const [mostCommonKey] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];

  const defaultDow = ALL_DOWS.find((dow) => spansKey(spansByDow.get(dow)!) === mostCommonKey)!;
  return {
    default: spansByDow.get(defaultDow)!,
    exceptions: ALL_DOWS.filter((dow) => spansKey(spansByDow.get(dow)!) !== mostCommonKey).map(
      (dow) => ({ dow, spans: spansByDow.get(dow)! }),
    ),
  };
}
