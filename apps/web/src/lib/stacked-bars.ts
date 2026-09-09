// Số học của biểu đồ cột xếp tầng (2026-09-09, chủ quán yêu cầu ở tab Thống kê NCC).
//
// Tách khỏi `Charts.tsx` cùng lệ với `supplier-stats`/`spend-buckets`: phần dễ sai của một cột
// xếp tầng không phải chuyện vẽ mà là chuyện CỘNG DỒN — tầng thứ k phải bắt đầu đúng ở chỗ
// tầng thứ k−1 kết thúc, và cột phải bỏ qua tầng bằng 0 nếu không sẽ có những vạch mỏng vô
// nghĩa chen giữa các màu. Cộng dồn thì test được mà không cần dựng màn hình lên.
//
// Mọi số ở đây là GIÁ TRỊ THẬT (đồng), chưa quy ra pixel — chỗ vẽ tự chia cho `yMax` của nó.

export type StackSeries = { values: number[] };

/** Tổng của từng cột. Chỉ truyền vào những chuỗi ĐANG HIỆN: tắt một NCC ở chú giải mà cột vẫn
 *  cao như cũ thì trục dọc nói dối về phần còn lại. */
export function tongMoiCot(series: readonly StackSeries[], soCot: number): number[] {
  const out = new Array<number>(Math.max(0, soCot)).fill(0);
  for (const s of series) {
    for (let i = 0; i < out.length; i++) out[i] += s.values[i] ?? 0;
  }
  return out;
}

/** Một tầng của một cột, tính từ đáy lên. `from`/`to` là giá trị cộng dồn, không phải pixel. */
export type Tang<T> = {
  chuoi: T;
  value: number;
  from: number;
  to: number;
};

/**
 * Các tầng của cột thứ `i`, xếp từ đáy lên theo ĐÚNG thứ tự `series` truyền vào.
 *
 * Giữ nguyên thứ tự chứ không xếp lại theo độ lớn của riêng cột này: `buildSpendChart` đã xếp
 * NCC theo tổng cả kỳ, nên NCC lớn nhất luôn nằm dưới cùng ở MỌI cột — mắt so được chiều dày
 * một dải màu qua các ngày. Xếp lại theo từng cột thì cùng một NCC nhảy tầng mỗi ngày và biểu
 * đồ không còn đọc được.
 *
 * Bỏ tầng ≤ 0: ngày không nhập của một NCC không được chiếm một vạch nào trên cột.
 */
export function tangCuaCot<T extends StackSeries>(series: readonly T[], i: number): Tang<T>[] {
  const out: Tang<T>[] = [];
  let dc = 0;
  for (const s of series) {
    const v = s.values[i] ?? 0;
    if (v <= 0) continue;
    out.push({ chuoi: s, value: v, from: dc, to: dc + v });
    dc += v;
  }
  return out;
}
