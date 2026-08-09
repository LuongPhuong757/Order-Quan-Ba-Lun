/**
 * Chuẩn hoá chữ Việt để so khớp khi tìm kiếm.
 *
 * `đ` KHÔNG phải chữ có dấu phụ — nó là một CHỮ CÁI riêng trong bảng chữ cái tiếng Việt, nên
 * `normalize('NFD')` không tách được gì khỏi nó và `\p{Diacritic}` không đụng tới. Bỏ sót chuyện
 * này là "dong" không bao giờ tìm ra "Đồng", "dai dong" trượt "Xã Đại Đồng" — mà tên xã ở Bắc
 * Ninh thì đầy chữ Đ. Đây là lý do file này tồn tại thay vì gọi thẳng `normalize('NFD')` tại chỗ.
 */
export function normalizeVi(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}
