// Chạy một loạt request SONG SONG và gom kết quả — dùng cho thao tác theo NHÓM món ở drawer
// (2026-09-15). Trước đó drawer làm `for (const id of ids) await api.patch(...)`: nhóm 5 dòng
// là 5 vòng round-trip nối tiếp, đo trên 4G ~175 ms/dòng — bồi bàn bấm "Đã giao" rồi chờ gần
// 1 giây. Màn Bếp đã dùng `Promise.allSettled` từ trước; đây là cùng một luật, gói lại để hai
// màn báo lỗi giống nhau.
//
// Không ném lỗi: một phần nhóm có thể đã đổi trạng thái thật trên server, nên người gọi phải
// biết "hỏng mấy dòng" để báo đúng, chứ không phải "hỏng hay không".

export type SettleResult<T> = {
  /** Kết quả của những việc thành công, theo thứ tự đầu vào (bỏ qua việc hỏng). */
  ok: T[];
  /** Số việc hỏng. */
  failed: number;
  /** Lỗi của việc hỏng ĐẦU TIÊN theo thứ tự đầu vào — để `extractError` ra thông báo cho user. */
  firstError: unknown;
};

/** Mỗi phần tử là một hàm tạo promise (không phải promise) để mọi request bắt đầu ở đây,
 *  cùng lúc, không phải ở chỗ người gọi dựng mảng. */
export async function settleAll<T>(tasks: Array<() => Promise<T>>): Promise<SettleResult<T>> {
  // `Promise.resolve().then(t)` chứ không gọi `t()` trần: hàm tạo ném ĐỒNG BỘ (vd dựng URL sai)
  // thì vẫn thành một dòng hỏng trong kết quả, không làm văng cả nhóm ra ngoài trước khi các
  // request khác kịp bắt đầu.
  const results = await Promise.allSettled(tasks.map((t) => Promise.resolve().then(t)));
  const ok: T[] = [];
  let failed = 0;
  let firstError: unknown = undefined;
  for (const r of results) {
    if (r.status === 'fulfilled') {
      ok.push(r.value);
    } else {
      if (failed === 0) firstError = r.reason;
      failed++;
    }
  }
  return { ok, failed, firstError };
}
