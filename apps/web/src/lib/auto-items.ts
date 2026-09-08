// Món GỢI SẴN trong giỏ khi mở màn gọi món của một bàn MỚI TINH (2026-09-08, chủ quán).
//
// Đặt ở FE chứ không phải BE — và đó là điểm mấu chốt của yêu cầu: khăn lạnh phải nằm trong
// GIỎ HÀNG để nhân viên còn sửa số lượng hoặc bỏ đi trước khi bấm Báo bếp. Bản đầu tôi cho BE
// tự thêm thẳng vào đơn lúc mở bàn: nó vào đơn rồi, muốn bỏ phải đi huỷ món — đúng thứ chủ quán
// KHÔNG muốn. Ở giỏ thì bỏ chỉ là bấm 🗑, chưa có gì chạm tới bếp hay tới tiền.
//
// Vì thế luật này KHÔNG còn bản sao nào ở BE nữa.

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

/** Kiểu bàn được gợi sẵn. Chỉ ăn tại chỗ: khách mang về và khách đặt giao không dùng khăn của
 * quán, gợi vào là mở đường thu thừa tiền. */
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
 * Chọn dòng menu để gợi sẵn vào giỏ. Trả `null` = không gợi gì.
 *
 * `isNewTable` = bàn CHƯA gọi món nào. Chỉ bàn mới tinh mới gợi: bàn đang ăn dở mà mỗi lần mở
 * giỏ lại nhét thêm 5 cái khăn là kiểu gì cũng có hôm trôi lọt vào bill.
 *
 * Dò theo TÊN chứ không theo mã: mã món do máy sinh lúc nhập bảng giá nên không đoán được, còn
 * tên thì chủ quán gõ và nhìn thấy. Dò lần lượt theo thứ tự ưu tiên, tên nào có hàng thì dừng.
 * Nhiều món cùng trúng thì lấy TÊN NGẮN NHẤT — quán đang có cả "Khăn Lạnh" (3.000đ) lẫn
 * "Khăn Lạnh 5 Cái" (15.000đ), mà ×5 phải nhân trên món ĐƠN LẺ; chọn gói 5 cái rồi nhân 5 nữa
 * là tính tiền 25 chiếc.
 *
 * Món đang HẾT thì bỏ qua: gợi sẵn một món không bán được chỉ tổ để nhân viên bấm Báo bếp rồi
 * ăn lỗi từ server.
 */
export function pickAutoItem<T extends AutoItemCandidate>(
  tableKind: string,
  isNewTable: boolean,
  menu: T[],
): { item: T; qty: number } | null {
  if (!isNewTable) return null;
  if (!AUTO_ITEM_TABLE_KINDS.includes(tableKind)) return null;
  for (const key of AUTO_ITEM_NAME_KEYS) {
    const hits = menu
      .filter((m) => !m.is_out_of_stock && khongDau(m.name).includes(key))
      .sort((a, b) => a.name.length - b.name.length);
    if (hits.length > 0) return { item: hits[0], qty: AUTO_ITEM_QTY };
  }
  return null;
}
