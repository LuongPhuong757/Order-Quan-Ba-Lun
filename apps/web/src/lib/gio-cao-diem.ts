// Trục giờ của biểu đồ "Giờ cao điểm" ở màn Lịch sử.
//
// BE luôn trả ĐỦ 24 khung giờ (0h–23h), kể cả giờ quán đóng cửa — xem `by_hour` trong
// `orders.service.ts`. Vẽ thẳng cả 24 cột thì hơn nửa biểu đồ là khoảng trắng của lúc 2h–7h
// sáng, và phần thật sự có khách bị bóp lại còn vài pixel.
//
// Module THUẦN, không import React: đây là phần duy nhất của biểu đồ kiểm được bằng test.

export type GioRow = { hour: number; orders: number; revenue: number };

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
 * Nhãn khung giờ: `14h` chứ không `14:00`.
 *
 * Trục có thể dài 16 cột trên màn 390px, mỗi nhãn thêm hai ký tự là hai ký tự phải bỏ bớt mốc.
 */
export function nhanGio(hour: number): string {
  return `${hour}h`;
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
