import { presetRange, vnDayIso, vnDayStartMs, shiftStartMs, type DayRange } from './date-range.ts';

/**
 * BỘ NÚT LỌC THỜI GIAN CHUNG của cả trang quản lý (Đợt 0 đồng bộ giao diện, chốt 2026-11-09).
 *
 * Trước đây có 4 bộ: `DateRangePicker` (Lịch sử, Thống kê NCC…), `FilterBar` riêng của NCC (thêm
 * Tháng này/Tháng trước), Sổ tiền ngân hàng tự vẽ ("Tự chọn…"), Đơn online theo GIỜ. Chữ, thứ
 * tự, cỡ nút mỗi nơi một khác. Giờ chỉ có MỘT thứ tự, MỘT bộ chữ; màn nào không cần nút nào thì
 * ẩn bớt (`DAY_SCREEN` / `SHIFT_SCREEN` / `ONLINE_SCREEN`) nhưng KHÔNG đổi tên, KHÔNG đổi thứ tự.
 *
 * Cách tính lấy NGUYÊN từ `date-range.ts` (ca từ 12h trưa) và `khoangCuaPreset` của NCC
 * (Tháng này = mùng 1 → hôm nay; Tháng trước = trọn tháng) — số liệu các màn không đổi.
 * Chỉ thêm "Hôm qua" (theo ngày lịch).
 */
export type TimePreset =
  | 'shift'
  | 'prev-shift'
  | 'today'
  | 'yesterday'
  | '7d'
  | '30d'
  | 'month'
  | 'lastmonth'
  | 'all';

/** Thứ tự DUY NHẤT trên mọi màn. */
export const PRESET_ORDER: readonly TimePreset[] = [
  'shift', 'prev-shift', 'today', 'yesterday', '7d', '30d', 'month', 'lastmonth', 'all',
];

export const PRESET_LABEL: Record<TimePreset, string> = {
  shift: 'Ca này',
  'prev-shift': 'Ca trước',
  today: 'Hôm nay',
  yesterday: 'Hôm qua',
  '7d': '7 ngày',
  '30d': '30 ngày',
  month: 'Tháng này',
  lastmonth: 'Tháng trước',
  all: 'Tất cả',
};

/** Màn KHÔNG có ca (NCC, Sổ tiền, Thống kê…). Mặc định mở màn: 30 ngày. */
export const DAY_SCREEN: readonly TimePreset[] = ['today', 'yesterday', '7d', '30d', 'month', 'lastmonth', 'all'];

/**
 * Màn CÓ ca (Lịch sử, Món đã bán). Mặc định mở màn: Ca này.
 * ẨN "Hôm nay / Hôm qua" (chủ quán chốt 2026-11-09): quán bán qua đêm tới 3h sáng, "Hôm qua"
 * theo ngày lịch cắt đôi một buổi bán và đứng cạnh "Ca trước" là người lớn tuổi nhầm ngay.
 */
export const SHIFT_SCREEN: readonly TimePreset[] = ['shift', 'prev-shift', '7d', '30d', 'month', 'lastmonth', 'all'];

/**
 * Đơn online: API chỉ hiểu "N giờ gần đây" (`?hours=`), KHÔNG lọc được khoảng có hai đầu →
 * chỉ giữ các nút quy được ra số giờ tính tới bây giờ (chủ quán chốt không sửa API).
 * Mặc định hàng chờ: Tất cả (không bao giờ sót đơn đang chờ duyệt).
 */
export const ONLINE_SCREEN: readonly TimePreset[] = ['today', '7d', '30d', 'month', 'all'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Khoảng ngày của một nút. `all` = không giới hạn; ca = cờ `shift` (mốc tính lúc dựng query). */
export function presetToRange(p: TimePreset, nowMs: number): DayRange {
  const today = vnDayIso(nowMs);
  const [y, m] = today.split('-').map(Number);
  switch (p) {
    case 'shift':
    case 'prev-shift':
    case 'today':
    case '7d':
    case '30d':
    case 'all':
      return presetRange(p, nowMs);
    case 'yesterday': {
      const d = vnDayIso(nowMs - 86_400_000);
      return { from: d, to: d };
    }
    case 'month':
      return { from: `${y}-${pad(m)}-01`, to: today };
    case 'lastmonth': {
      const ly = m === 1 ? y - 1 : y;
      const lm = m === 1 ? 12 : m - 1;
      const last = new Date(Date.UTC(ly, lm, 0)).getUTCDate();
      return { from: `${ly}-${pad(lm)}-01`, to: `${ly}-${pad(lm)}-${pad(last)}` };
    }
  }
}

/**
 * Nút nào đang sáng, suy NGƯỢC từ khoảng ngày (không giữ state "preset" riêng: sửa tay ngày mà
 * nút vẫn sáng là giao diện nói dối). Chỉ xét các nút màn đó có; không khớp → `'custom'`.
 */
export function detectPreset(
  r: DayRange,
  nowMs: number,
  allowed: readonly TimePreset[] = PRESET_ORDER,
): TimePreset | 'custom' {
  if (r.shift === 'current') return allowed.includes('shift') ? 'shift' : 'custom';
  if (r.shift === 'prev') return allowed.includes('prev-shift') ? 'prev-shift' : 'custom';
  for (const p of allowed) {
    if (p === 'shift' || p === 'prev-shift') continue;
    const k = presetToRange(p, nowMs);
    if (k.from === r.from && k.to === r.to) return p;
  }
  return 'custom';
}

/**
 * Quy nút ra số GIỜ tính lùi từ bây giờ — cho Đơn online (API `?hours=`). `null` = Tất cả.
 * Làm tròn LÊN để không cắt mất đơn đặt ở phút đầu tiên của khoảng.
 */
export function presetToHours(p: TimePreset, nowMs: number): number | null {
  if (p === 'all') return null;
  const startMs = p === 'shift' ? shiftStartMs(nowMs) : vnDayStartMs(presetToRange(p, nowMs).from);
  return Math.max(1, Math.ceil((nowMs - startMs) / 3_600_000));
}

/** Số ngày trong khoảng (gồm cả hai đầu) — cho nút "Xem 9 ngày". */
export function countDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** 'YYYY-MM-DD' → 'dd/mm/yyyy' — ngày LUÔN ghi kiểu Việt Nam, bất kể máy cài ngôn ngữ gì. */
export function viDate(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
