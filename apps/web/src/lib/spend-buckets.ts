// Gộp chi tiêu theo ngày thành các cột vẽ được (2026-09-07, tab "Thống kê" của màn NCC).
//
// Hai việc mà biểu đồ cột KHÔNG làm được nếu đưa dữ liệu thô vào:
//
// 1. Ngày không nhập hàng phải là cột 0, không phải cột bị bỏ qua. Bỏ qua thì 3 ngày nghỉ liền
//    nhau trông y như 3 ngày nhập đều — mất đúng thứ cần thấy ("hôm đó dồn hàng vì trước đó
//    nghỉ 4 ngày").
// 2. Khoảng dài phải tự gộp lại. "Tất cả" của một quán chạy 2 năm là 730 cột; vẽ ra thì mỗi cột
//    1px và phải vuốt ngang 20 lần. Chuyển sang tuần/tháng thì cùng câu trả lời, một màn hình.
import { addDaysIso, monthStartIso } from './date-range.ts';

/** Một cột trên biểu đồ. `tooltip` là câu đầy đủ khi trỏ/giữ vào cột (nhãn dưới cột bị bóp
 *  ngắn cho vừa 34px nên không nói đủ được, vd '07/09' không có năm). */
export type SpendBucket = {
  key: string;
  label: string;
  tooltip: string;
  value: number;
};

export type Granularity = 'day' | 'week' | 'month';

/** Số ngày của khoảng [from, to], tính CẢ hai đầu. */
function spanDays(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

/**
 * Mức gộp theo độ dài khoảng.
 *
 * 45 ngày là mốc CỐ Ý cao hơn 31: hai preset "Tháng này"/"Tháng trước" và "30 ngày" đều phải ra
 * cột-theo-ngày, còn nếu để mốc 31 thì tháng 31 ngày lại gộp thành tuần trong khi tháng 30 ngày
 * thì không — cùng một câu hỏi mà hai tháng liền nhau trả lời bằng hai loại biểu đồ.
 *
 * 190 ngày ≈ 6 tháng, ra tối đa 28 cột tuần. Trên mức đó chuyển sang tháng.
 */
export function pickGranularity(from: string, to: string): Granularity {
  const days = spanDays(from, to);
  if (days <= 45) return 'day';
  if (days <= 190) return 'week';
  return 'month';
}

/** Thứ Hai của tuần chứa `iso`. Tuần bắt đầu THỨ HAI, không phải Chủ nhật — lịch VN. */
export function weekStartIso(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  // getUTCDay: 0=CN … 6=T7. Cần số ngày phải lùi để về thứ Hai: CN lùi 6, T2 lùi 0.
  return addDaysIso(iso, -((d.getUTCDay() + 6) % 7));
}

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const dmy = (iso: string) => `${dm(iso)}/${iso.slice(0, 4)}`;

/** Mốc đầu của ô chứa `iso`, theo mức gộp. */
function bucketStart(iso: string, g: Granularity): string {
  if (g === 'day') return iso;
  if (g === 'week') return weekStartIso(iso);
  return monthStartIso(iso);
}

/** Mốc đầu của ô LIỀN SAU ô bắt đầu tại `start`. */
function nextBucket(start: string, g: Granularity): string {
  if (g === 'day') return addDaysIso(start, 1);
  if (g === 'week') return addDaysIso(start, 7);
  // Sang mùng 1 tháng sau: cộng 31 ngày rồi kéo về mùng 1 — luôn đúng vì không tháng nào dài
  // hơn 31 ngày, nên mùng 1 + 31 ngày chắc chắn đã sang tháng sau và chưa qua tháng sau nữa.
  return monthStartIso(addDaysIso(start, 31));
}

function labelOf(start: string, g: Granularity): { label: string; tooltip: string } {
  if (g === 'day') return { label: dm(start), tooltip: `Ngày ${dmy(start)}` };
  if (g === 'week') {
    const end = addDaysIso(start, 6);
    return { label: dm(start), tooltip: `Tuần ${dm(start)} – ${dmy(end)}` };
  }
  return {
    label: `${start.slice(5, 7)}/${start.slice(2, 4)}`,
    tooltip: `Tháng ${start.slice(5, 7)}/${start.slice(0, 4)}`,
  };
}

/**
 * Gộp các ngày có chi tiêu thành dãy cột liên tục, không đứt đoạn.
 *
 * `from`/`to` là khoảng ĐANG LỌC. Bỏ trống đầu nào thì lấy mốc từ dữ liệu — khoảng "Tất cả"
 * không có hai đầu, và vẽ từ ngày nhập đầu tiên là đúng: đệm thêm những tháng trước khi quán
 * mở cửa chỉ làm biểu đồ dài ra bằng cột 0.
 *
 * Trả về `[]` khi không có ngày nào — người gọi tự hiện khối "chưa có dữ liệu".
 */
export function bucketDailySpend(
  rows: ReadonlyArray<{ delivery_date: string; amount: number }>,
  range: { from?: string; to?: string } = {},
): { granularity: Granularity; buckets: SpendBucket[] } {
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(r.delivery_date, (byDay.get(r.delivery_date) ?? 0) + r.amount);

  const dates = [...byDay.keys()].sort();
  const from = range.from || dates[0];
  const to = range.to || dates[dates.length - 1];
  if (!from || !to || from > to) return { granularity: 'day', buckets: [] };

  const granularity = pickGranularity(from, to);

  // Dồn từng ngày về ô của nó TRƯỚC, rồi mới chạy dãy ô — không quét lại toàn bộ ngày cho mỗi ô.
  const sums = new Map<string, number>();
  for (const [day, amount] of byDay) {
    const k = bucketStart(day, granularity);
    sums.set(k, (sums.get(k) ?? 0) + amount);
  }

  const buckets: SpendBucket[] = [];
  // Chạy theo Ô, không theo từng ngày: khoảng "tất cả" của quán 2 năm là 730 vòng nếu chạy theo
  // ngày, mà kết quả chỉ có 24 cột.
  for (let start = bucketStart(from, granularity); start <= to; start = nextBucket(start, granularity)) {
    buckets.push({ key: start, value: sums.get(start) ?? 0, ...labelOf(start, granularity) });
  }
  return { granularity, buckets };
}

/** Câu giải thích dưới tiêu đề biểu đồ — nói rõ một cột là bao lâu. */
export function granularityHint(g: Granularity): string {
  if (g === 'day') return 'Mỗi cột là một ngày · ngày không nhập hàng là cột 0';
  if (g === 'week') return 'Khoảng dài nên gộp theo TUẦN · mỗi cột là 7 ngày kể từ thứ Hai';
  return 'Khoảng dài nên gộp theo THÁNG · mỗi cột là một tháng';
}
