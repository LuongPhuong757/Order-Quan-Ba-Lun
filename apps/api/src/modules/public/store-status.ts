// Nguồn: M2.D-17 (Ingest CONTEXT), M2.D-28, M2.D-30 — pure function, KHÔNG import DataSource.
// Module thuần: không import gì từ @nestjs/* hay typeorm, để test được mà không dựng app/DB.
//
// D-17: "OFF đến hết hôm nay" và "ngoài giờ mở cửa" đều TÍNH LÚC ĐỌC, không dùng cron.
// Hàm này KHÔNG mutate settings khi tự-động hết hạn (không ghi lại DB) — đúng nghĩa
// "tính lúc đọc". `nowMs` LUÔN là tham số — TUYỆT ĐỐI không đọc giờ hệ thống bên trong
// (ràng buộc của 08-VALIDATION.md, để test được auto-revert qua 00:00 mà không cần fake timer).

// ICT (UTC+7) cố định quanh năm, không có giờ mùa hè (xem Sources trong 08-RESEARCH.md)
// → không cần thư viện timezone, cộng offset cố định là đủ chính xác.
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

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
  enabled: boolean; // kết luận cuối cùng, dùng để cho phép/chặn submit
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

function isWithinOpenHours(openHours: OpenHourRule[], nowMs: number): boolean {
  // open_hours rỗng (chưa cấu hình, default spec §4.1) → KHÔNG giới hạn giờ, luôn mở.
  // Điều chỉnh BẮT BUỘC so với bản mẫu 08-RESEARCH.md: bản mẫu trả `false` khi không
  // tìm thấy rule, sẽ khoá toàn bộ quán mới cài vì spec §4.1 đặt default open_hours = [].
  if (openHours.length === 0) return true;

  const vnMs = nowMs + VN_OFFSET_MS;
  const vnDate = new Date(vnMs);
  const dow = vnDate.getUTCDay() as OpenHoursDow;
  const minutesNow = vnDate.getUTCHours() * 60 + vnDate.getUTCMinutes();
  const rule = openHours.find((r) => r.dow === dow);
  if (!rule) return false; // nghỉ ngày đó (rule thiếu cho dow hiện tại)
  return inRange(minutesNow, rule.from, rule.to);
}

function inRange(minutes: number, from: string, to: string): boolean {
  const [fh, fm] = from.split(':').map(Number);
  const [th, tm] = to.split(':').map(Number);
  return minutes >= fh * 60 + fm && minutes < th * 60 + tm;
}

// Shape "mặc định + ngoại lệ" cho D-15 (UI /admin/settings), tách khỏi shape lưu DB
// (spec §schema không đổi — open_hours vẫn luôn 7 phần tử khi đọc/ghi DB).
export type OpenHoursInput = {
  default: { from: string; to: string };
  exceptions: Array<{ dow: OpenHoursDow; from: string; to: string }>;
};

export function expandToWeek(input: OpenHoursInput): OpenHourRule[] {
  const byDow = new Map(input.exceptions.map((e) => [e.dow, e]));
  const allDows: OpenHoursDow[] = [0, 1, 2, 3, 4, 5, 6];
  return allDows.map((dow) => {
    const ex = byDow.get(dow);
    return ex ?? { dow, ...input.default };
  });
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

// Chiều ngược lại (đọc để hiển thị form): dòng nào KHÔNG khớp giá trị phổ biến nhất → thành exception.
export function collapseToDefaultExceptions(rules: OpenHourRule[]): OpenHoursInput {
  const counts = new Map<string, number>();
  for (const r of rules) {
    const key = `${r.from}-${r.to}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [mostCommonKey] = sorted[0];
  const [from, to] = mostCommonKey.split('-');
  const exceptions = rules
    .filter((r) => `${r.from}-${r.to}` !== mostCommonKey)
    .map((r) => ({ dow: r.dow, from: r.from, to: r.to }));
  return { default: { from, to }, exceptions };
}
