/**
 * Khoảng ngày cho các thanh lọc thời gian.
 *
 * Mọi thứ ở đây tính theo NGÀY KINH DOANH GIỜ VN (+7), không theo giờ máy và cũng không theo
 * UTC. Quán ở VN nên "hôm nay" phải là hôm nay của quán; máy nào đặt sai múi giờ vẫn phải ra
 * cùng một ngày. Đây cũng là quy ước `vnDayKey` mà bảng Lịch sử đang dùng để gom đơn theo
 * ngày — hai chỗ lệch nhau thì bộ lọc và bảng sẽ nói hai ngày khác nhau.
 */

const VN_OFFSET_MS = 7 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

/** 'YYYY-MM-DD' theo giờ VN từ epoch ms. */
export function vnDayIso(ms: number): string {
  return new Date(ms + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** Cộng/trừ ngày trên chuỗi 'YYYY-MM-DD', vẫn theo giờ VN. */
export function addDaysIso(iso: string, days: number): string {
  const base = Date.parse(`${iso}T00:00:00Z`);
  return new Date(base + days * DAY_MS).toISOString().slice(0, 10);
}

export type RangePreset = 'all' | 'today' | '7d' | '30d';

export type DayRange = { from: string; to: string };

/** Khoảng ngày ứng với một preset. `all` = không giới hạn hai đầu. */
export function presetRange(preset: RangePreset, nowMs: number): DayRange {
  const today = vnDayIso(nowMs);
  switch (preset) {
    case 'all':
      return { from: '', to: '' };
    case 'today':
      return { from: today, to: today };
    // "7 ngày" ĐÃ GỒM hôm nay, nên lùi 6 chứ không phải 7 — lùi 7 là 8 ngày, và con số tổng
    // ở dưới bảng sẽ không khớp với nhãn người dùng vừa bấm.
    case '7d':
      return { from: addDaysIso(today, -6), to: today };
    case '30d':
      return { from: addDaysIso(today, -29), to: today };
  }
}

/**
 * Khoảng ngày hiện tại ứng với preset nào, `null` nếu là khoảng người dùng tự chọn.
 *
 * Suy ngược từ giá trị thay vì giữ thêm một biến state "preset đang chọn": hai nguồn sự thật
 * thì sớm muộn cũng lệch — sửa tay một ô ngày mà chip vẫn sáng là nói dối người dùng.
 */
export function matchPreset(range: DayRange, nowMs: number): RangePreset | null {
  const presets: RangePreset[] = ['all', 'today', '7d', '30d'];
  for (const p of presets) {
    const r = presetRange(p, nowMs);
    if (r.from === range.from && r.to === range.to) return p;
  }
  return null;
}

/**
 * Câu mô tả khoảng đang xem, bằng tiếng Việt.
 *
 * Cần có vì ô `<input type="date">` hiển thị theo LOCALE CỦA MÁY: máy để tiếng Anh thì
 * "09/01/2026" là mùng 1 tháng 9, đọc như mùng 9 tháng 1. Dòng này là chỗ duy nhất nói rõ
 * không nhầm được.
 */
export function rangeLabel(range: DayRange): string {
  const d = (iso: string) => {
    const [y, m, day] = iso.split('-');
    return `${day}/${m}/${y}`;
  };
  if (!range.from && !range.to) return 'Tất cả thời gian';
  if (range.from && !range.to) return `Từ ${d(range.from)}`;
  if (!range.from && range.to) return `Đến ${d(range.to)}`;
  if (range.from === range.to) return `Ngày ${d(range.from)}`;
  return `${d(range.from)} – ${d(range.to)}`;
}
