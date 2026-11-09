// Nhớ bộ lọc + khoảng ngày + trang của một màn danh sách khi rời màn rồi quay lại (chủ quán chốt
// 2026-11-09, cách 1 trong docs/UI-UX/phan-trang.md). Hiện chỉ màn Lịch sử dùng.
//
// Vì sao nhớ CẢ bộ lọc chứ không chỉ số trang: "trang 10" chỉ có nghĩa với đúng bộ lọc đã sinh
// ra nó — nhớ trang mà bộ lọc về mặc định là đưa người ta vào giữa một danh sách khác hẳn.
//
// Vì sao sessionStorage: sống tới khi ĐÓNG TAB — đủ cho "bấm sang Order rồi quay lại", mà mở
// app lần sau vẫn về mặc định (ca đang chạy) như cũ. Khoá có id người dùng: đăng xuất rồi người
// khác đăng nhập cùng tab thì không thừa hưởng bộ lọc (có thể là ô họ không có quyền thấy).
import { shiftStartMs, type DayRange } from './date-range.ts';
import { detectPreset, presetToRange, type TimePreset } from './time-presets.ts';

/** Khoảng ngày lưu lại: nút nhanh thì lưu TÊN NÚT để mai mở ra "Hôm nay" vẫn là hôm nay. */
export type KhoangDaLuu = { preset: TimePreset } | { range: DayRange };

export function luuKhoang(r: DayRange, nowMs: number): KhoangDaLuu {
  const p = detectPreset(r, nowMs);
  return p === 'custom' ? { range: r } : { preset: p };
}

export function khoiPhucKhoang(k: KhoangDaLuu, nowMs: number): DayRange {
  return 'preset' in k ? presetToRange(k.preset, nowMs) : k.range;
}

/**
 * Dấu vân tay của CỬA SỔ DỮ LIỆU thật sự. Đổi = dữ liệu dưới các trang đã khác (sang ca mới lúc
 * 12h trưa, "Hôm nay" sang ngày mới) → phải về trang 1, không thì trang 10 cũ trỏ vào khoảng
 * trống hoặc vào đơn khác.
 */
export function vanTayKy(r: DayRange, nowMs: number): string {
  if (r.shift) return `ca:${r.shift}:${shiftStartMs(nowMs)}`;
  return `ngay:${r.from}..${r.to}`;
}

export function docNho<T>(khoa: string): T | null {
  try {
    const raw = sessionStorage.getItem(khoa);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    // Chế độ ẩn danh / bị chặn lưu trữ / JSON hỏng → coi như chưa nhớ gì, màn về mặc định.
    return null;
  }
}

export function ghiNho(khoa: string, giaTri: unknown): void {
  try {
    sessionStorage.setItem(khoa, JSON.stringify(giaTri));
  } catch {
    // Đầy bộ nhớ / bị chặn → bỏ qua: nhớ bộ lọc chỉ là tiện, không được làm vỡ màn.
  }
}
