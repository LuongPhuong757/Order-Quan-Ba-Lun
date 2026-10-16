// Phép tính thuần dùng chung cho hai màn "sổ tiền" thiết kế lại theo kiểu app ngân hàng
// (2026-10-16): Sổ webhook và Trả tiền NCC. Tách khỏi component để test được.
import { addDaysIso, vnDayIso } from './date-range.ts';

const THU = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

/** `16/10` từ `2026-10-16`. */
export function ddmm(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

/** Tiêu đề nhóm ngày như app ngân hàng: "Hôm nay · Thứ Năm 16/10", "Hôm qua · …", còn lại
 *  "Thứ Ba 14/10". Thứ lấy theo NGÀY LỊCH của chuỗi ISO (giờ VN đã quy ở `vnDayIso`), không theo
 *  múi giờ của máy đang xem. */
export function dayHeading(iso: string, todayIso: string): string {
  const thu = THU[new Date(`${iso}T00:00:00Z`).getUTCDay()];
  const ten = `${thu} ${ddmm(iso)}`;
  if (iso === todayIso) return `Hôm nay · ${ten}`;
  if (iso === addDaysIso(todayIso, -1)) return `Hôm qua · ${ten}`;
  return ten;
}

export type DayGroup<T> = { day: string; rows: T[] };

/** Gom theo ngày, GIỮ thứ tự đầu vào — danh sách vốn đã xếp mới nhất trước. */
export function groupByDay<T>(rows: readonly T[], dayOf: (r: T) => string): DayGroup<T>[] {
  const out: DayGroup<T>[] = [];
  for (const r of rows) {
    const day = dayOf(r);
    const last = out[out.length - 1];
    if (last && last.day === day) last.rows.push(r);
    else out.push({ day, rows: [r] });
  }
  return out;
}

/** `…8888` — bốn số cuối để đối chiếu với sao kê. */
export const tail4 = (accountNo: string): string => `…${accountNo.slice(-4)}`;

/** Màu chấm nhận diện tài khoản. Băm từ khoá tài khoản chứ không theo thứ tự trong danh sách: thứ
 *  tự đổi theo kỳ đang xem, mà màu đổi theo thì người ta mất luôn thói quen nhìn màu nhận tài khoản. */
const DOT = ['#6d28d9', '#1d4ed8', '#0e7490', '#15803d', '#b45309', '#be185d'];
export function accountDot(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return DOT[h % DOT.length];
}

/** Kỳ "Tháng này": mùng 1 tới hôm nay, theo giờ VN. */
export function monthRange(nowMs: number): { from: string; to: string } {
  const today = vnDayIso(nowMs);
  return { from: `${today.slice(0, 8)}01`, to: today };
}

export const vnd = (n: number): string => `${n.toLocaleString('vi-VN')}đ`;
