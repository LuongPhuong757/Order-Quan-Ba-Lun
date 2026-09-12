// Trục giờ của biểu đồ "Giờ cao điểm" ở màn Lịch sử.
//
// BE luôn trả ĐỦ 48 mốc nửa tiếng (0h00–23h30), kể cả lúc quán đóng cửa — xem `by_half_hour`
// trong `orders.service.ts`. Vẽ thẳng cả 48 cột thì hơn nửa biểu đồ là khoảng trắng của lúc
// 2h–7h sáng, và phần thật sự có khách bị bóp lại còn vài pixel.
//
// Module THUẦN, không import React: đây là phần duy nhất của biểu đồ kiểm được bằng test.

/** Một mốc nửa tiếng. `start_min` = phút tính từ 0h giờ VN: 0, 30, 60 … 1410. */
export type GioRow = { start_min: number; orders: number; revenue: number };

/**
 * Cắt các khung giờ RỖNG ở HAI ĐẦU, giữ nguyên khoảng trống ở GIỮA.
 *
 * Giữ giờ trống ở giữa là có chủ ý: quán bán sáng rồi nghỉ trưa rồi bán tối thì cái hõm lúc
 * 14h–16h là thông tin thật — bỏ đi thì 13h đứng cạnh 17h và biểu đồ nói dối rằng quán bán
 * liên tục. Còn hai đầu thì khác: 0h–7h không có đơn không phải là "vắng khách", mà là quán
 * chưa mở.
 *
 * Không có đơn nào trong cả kỳ → trả về mảng RỖNG, để chỗ gọi hiện "Chưa có dữ liệu" thay vì
 * vẽ một trục 24 giờ phẳng lì.
 */
export function catGioTrongHaiDau(rows: readonly GioRow[]): GioRow[] {
  const dau = rows.findIndex((r) => r.orders > 0 || r.revenue > 0);
  if (dau === -1) return [];
  let cuoi = rows.length - 1;
  while (cuoi > dau && rows[cuoi].orders === 0 && rows[cuoi].revenue === 0) cuoi--;
  return rows.slice(dau, cuoi + 1);
}

/**
 * Nhãn mốc nửa tiếng: `14h` cho đầu giờ, `14h30` cho nửa sau. Không dùng `14:00`/`14:30` —
 * trục có thể dài 32 cột trên màn 390px, mỗi nhãn thêm hai ký tự là hai ký tự phải bỏ bớt mốc.
 *
 * Mốc tròn giờ CỐ Ý ngắn hơn mốc rưỡi (`14h` so với `14h30`): khi hết chỗ, `buocNhanTruc` thưa
 * nhãn đi và thứ còn lại gần như luôn là mốc tròn giờ — trục đọc ra vẫn là "8h, 9h, 10h" quen
 * mắt, chỉ dày thêm cột ở giữa.
 */
export function nhanGio(startMin: number): string {
  const h = Math.floor(startMin / 60);
  const m = startMin % 60;
  return m === 0 ? `${h}h` : `${h}h${m}`;
}

/**
 * Ghi nhãn trục ngang cách mấy cột một lần, để chữ không dính vào nhau.
 *
 * Bề rộng cần cho một nhãn tính từ CHỮ DÀI NHẤT chứ không phải một hằng số: `8h` rộng ~20px
 * còn `20/08` rộng ~39px. Lấy chung một con số thì hoặc trục giờ thưa vô cớ (mất mốc đáng ra
 * ghi được), hoặc trục ngày dính chữ thành một vệt xám. ~6,2px mỗi ký tự ở font 11px, cộng
 * 8px khe hở giữa hai nhãn.
 */
export function buocNhanTruc(nhan: readonly string[], oCot: number): number {
  if (nhan.length === 0) return 1;
  const rongNhan = Math.max(...nhan.map((l) => l.length)) * 6.2 + 8;
  return Math.max(1, Math.ceil(rongNhan / Math.max(0.1, oCot)));
}

/**
 * Chỉ số các cột được GHI NHÃN, khi trục chỉ đủ chỗ cho mỗi `buoc` cột một nhãn.
 *
 * Cột đầu và cột cuối luôn có nhãn — thiếu chúng thì không biết trục bắt đầu và kết thúc ở
 * đâu. Nhưng nhãn cuối KHÔNG được cộng thêm một cách mù quáng: mốc đều gần nhất có thể vừa
 * rơi cách đó một hai cột, và hai nhãn chồng lên nhau thành một vệt không đọc được — trục mốc
 * 30 phút kết thúc lúc 22h30 từng hiện ra "22h22h30". Nên mốc đều nào lấn vào chỗ của nhãn
 * cuối thì bỏ chính nó đi, giữ nhãn cuối.
 */
export function chiSoGhiNhan(soCot: number, buoc: number): Set<number> {
  const n = Math.max(0, Math.floor(soCot));
  const b = Math.max(1, Math.floor(buoc));
  const ra = new Set<number>();
  if (n === 0) return ra;
  for (let i = 0; i < n; i += b) ra.add(i);
  for (const i of [...ra]) if (i !== 0 && n - 1 - i < b) ra.delete(i);
  ra.add(n - 1);
  return ra;
}
