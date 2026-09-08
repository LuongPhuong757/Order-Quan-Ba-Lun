// Món TỰ THÊM khi mở bàn (2026-09-08, chủ quán: "khi mở order ra auto thêm khăn ướt x5, chỉ áp
// dụng cho bàn ăn tại chỗ").
//
// Tách khỏi `OrdersService` để phần "món nào, mấy phần, bàn nào được áp" có test riêng: nó là
// LUẬT BÁN HÀNG, và từ 2026-09-08 mọi món chưa huỷ đều tính tiền — thêm nhầm một dòng vào bàn
// mang về là thu thừa tiền của khách.

/** Bỏ dấu tiếng Việt + hạ chữ thường + gộp khoảng trắng. Dùng để dò tên món mà không phụ thuộc
 * chủ quán gõ "Khăn ướt", "KHĂN ƯỚT" hay "Khăn Ướt " lúc nhập bảng giá. */
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

/** Kiểu bàn ĐƯỢC tự thêm. Chỉ ăn tại chỗ: khách mang về và khách đặt giao không dùng khăn ướt
 * của quán, thêm vào là thu thừa tiền. */
export const AUTO_ITEM_TABLE_KINDS = ['dine-in'];

/** Tên món cần dò, dạng KHÔNG DẤU, xếp theo thứ tự ưu tiên.
 *
 * Chủ quán gọi món này là "khăn ướt", nhưng trong bảng giá thật nó tên là "Khăn Lạnh"
 * (SP001137, 3.000đ/phần) — kiểm bằng chính DB ngày 2026-09-08 sau khi tính năng chạy mà không
 * thêm được gì. Giữ CẢ HAI tên: quán đổi bảng giá lúc nào không ai báo trước, và một danh sách
 * là chỗ rẻ nhất để thêm tên mới.
 *
 * Dò lần lượt, tên nào có hàng thì dừng — KHÔNG gộp chung rồi lấy tên ngắn nhất: nếu mai kia
 * quán có cả "Khăn ướt" lẫn "Khăn lạnh" thì phải theo đúng thứ tự chủ quán muốn, chứ không phải
 * theo cái nào tên ngắn hơn.
 */
export const AUTO_ITEM_NAME_KEYS = ['khan uot', 'khan lanh'];
export const AUTO_ITEM_QTY = 5;

export type AutoItemCandidate = { id: string; name: string; is_active?: boolean };

/**
 * Chọn dòng menu để tự thêm cho một bàn vừa mở. Trả `null` = không thêm gì.
 *
 * Dò theo TÊN chứ không theo mã: mã món do máy sinh lúc nhập bảng giá nên không đoán được, còn
 * tên thì chủ quán gõ và nhìn thấy. Khớp bằng `includes` để "Khăn Lạnh", "Khăn lạnh thơm" hay
 * "Khăn ướt Bà Lùn" đều trúng; nhiều món cùng trúng thì lấy TÊN NGẮN NHẤT — quán đang có cả
 * "Khăn Lạnh" (3.000đ) lẫn "Khăn Lạnh 5 Cái" (15.000đ), và ×5 phải nhân trên món ĐƠN LẺ, chọn
 * gói 5 cái rồi nhân 5 nữa là tính tiền 25 chiếc.
 *
 * Không tìm thấy thì im lặng bỏ qua: quán chưa tạo món khăn ướt trong menu KHÔNG được phép làm
 * hỏng thao tác mở bàn.
 */
export function pickAutoItem(
  tableKind: string,
  menu: AutoItemCandidate[],
): { menu_item_id: string; qty: number } | null {
  if (!AUTO_ITEM_TABLE_KINDS.includes(tableKind)) return null;
  for (const key of AUTO_ITEM_NAME_KEYS) {
    const hits = menu
      .filter((m) => m.is_active !== false && khongDau(m.name).includes(key))
      .sort((a, b) => a.name.length - b.name.length);
    if (hits.length > 0) return { menu_item_id: hits[0].id, qty: AUTO_ITEM_QTY };
  }
  return null;
}
