/* Món TỰ THÊM: khăn lạnh cho bàn ăn tại chỗ (2026-09-08, chủ quán).
 *
 * ── Vì sao luật nằm ở package dùng chung chứ không ở apps/web ──
 * Từ M7 (2026-10-01) nó có HAI nơi dùng, ở hai phía khác nhau của mạng:
 *
 *  1. `apps/web` — nhân viên mở màn gọi món của một bàn mới: khăn được bỏ sẵn vào GIỎ để còn
 *     sửa số lượng hoặc bỏ đi trước khi bấm Báo bếp. Đây là yêu cầu gốc của chủ quán: bản đầu
 *     cho BE thêm thẳng vào đơn, mà vào đơn rồi thì muốn bỏ phải đi huỷ món.
 *  2. `apps/api` — khách quét QR tự gọi: luồng đó KHÔNG có giỏ của nhân viên, chỉ có đúng một
 *     nút "Duyệt cả lượt" ở màn bếp. Không có chỗ nào để bỏ sẵn, nên khăn phải được thêm ở
 *     phía server đúng lúc duyệt.
 *
 * Hai bản sao của cùng một luật là cách chắc chắn nhất để sau này quán đổi tên món trong bảng
 * giá rồi một bên nhận ra còn bên kia thì không. Nên luật ở một chỗ, hai bên cùng import.
 *
 * File này KHÔNG có zod — nó nằm trong `@order/schemas` chỉ vì đó là package duy nhất mà CẢ
 * apps/web lẫn apps/api đều đã khai phụ thuộc sẵn.
 */

/** Bỏ dấu tiếng Việt + hạ chữ thường + gộp khoảng trắng. Để dò tên món mà không phụ thuộc chủ
 * quán gõ "Khăn lạnh", "KHĂN LẠNH" hay "Khăn Lạnh " lúc nhập bảng giá. */
export function khongDau(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Kiểu bàn được thêm khăn. Chỉ ăn tại chỗ: khách mang về và khách đặt giao không dùng khăn
 *  của quán, thêm vào là mở đường thu thừa tiền. */
export const AUTO_ITEM_TABLE_KINDS = ['dine-in'];

/** Tên món cần dò, dạng KHÔNG DẤU, xếp theo thứ tự ưu tiên.
 *
 * Chủ quán gọi món này là "khăn ướt", nhưng bảng giá thật ghi "Khăn Lạnh" (SP001137, 3.000đ) —
 * kiểm bằng chính DB ngày 2026-09-08. Giữ cả hai tên: quán đổi bảng giá lúc nào không ai báo
 * trước, và một danh sách là chỗ rẻ nhất để thêm tên mới. */
export const AUTO_ITEM_NAME_KEYS = ['khan uot', 'khan lanh'];

export const AUTO_ITEM_QTY = 5;

export type AutoItemCandidate = { id: string; name: string; is_out_of_stock?: boolean };

/**
 * Chọn dòng menu để thêm khăn. Trả `null` = không thêm gì.
 *
 * `isNewTable` = bàn CHƯA có món nào xuống bếp. Chỉ bàn mới tinh mới thêm: bàn đang ăn dở mà
 * mỗi lượt gọi lại nhét thêm 5 cái khăn là kiểu gì cũng có hôm trôi lọt vào bill.
 *
 * Dò theo TÊN chứ không theo mã: mã món do máy sinh lúc nhập bảng giá nên không đoán được, còn
 * tên thì chủ quán gõ và nhìn thấy. Dò lần lượt theo thứ tự ưu tiên, tên nào có hàng thì dừng.
 * Nhiều món cùng trúng thì lấy TÊN NGẮN NHẤT — quán đang có cả "Khăn Lạnh" (3.000đ) lẫn
 * "Khăn Lạnh 5 Cái" (15.000đ), mà ×5 phải nhân trên món ĐƠN LẺ; chọn gói 5 cái rồi nhân 5 nữa
 * là tính tiền 25 chiếc.
 *
 * Món đang HẾT thì bỏ qua: thêm một món không bán được chỉ tổ để lượt duyệt ăn lỗi từ server.
 */
export function pickAutoItem<T extends AutoItemCandidate>(
  tableKind: string,
  isNewTable: boolean,
  menu: readonly T[],
): { item: T; qty: number } | null {
  if (!isNewTable) return null;
  if (!AUTO_ITEM_TABLE_KINDS.includes(tableKind)) return null;
  for (const key of AUTO_ITEM_NAME_KEYS) {
    const hits = menu
      .filter((m) => !m.is_out_of_stock && khongDau(m.name).includes(key))
      .sort((a, b) => a.name.length - b.name.length);
    if (hits.length > 0) return { item: hits[0]!, qty: AUTO_ITEM_QTY };
  }
  return null;
}
