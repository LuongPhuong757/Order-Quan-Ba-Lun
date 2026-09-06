/**
 * Chuẩn hoá chữ hoa/thường cho ô nhập tên mặt hàng và ô đơn vị tính (chủ quán yêu cầu
 * 2026-09-06: "thịt bò tự động chuyển thành Thịt Bò", "đơn vị tính tự động chữ thường").
 *
 * Vì sao đáng có, chứ không phải chuyện thẩm mỹ: danh mục nguyên liệu là MỘT bảng DÙNG CHUNG giữa
 * nhập hàng và công thức món. Người nhập lúc 6h sáng gõ "thit bo", tối gõ "Thịt Bò", hôm sau gõ
 * "THỊT BÒ" — mỗi biến thể là một dòng mới trong danh mục, và tồn kho của cùng một thứ bị xẻ làm
 * ba. Ép về một dạng ngay tại ô nhập là chỗ rẻ nhất để chặn.
 *
 * `toLocaleLowerCase('vi')` chứ không phải `toLowerCase()`: tiếng Việt không có luật đổi chữ nào
 * khác tiếng Anh, nhưng khai locale rõ ràng để không dính bẫy Thổ Nhĩ Kỳ (I → ı) nếu máy chủ hay
 * trình duyệt chạy locale đó.
 */

const VI = 'vi';

/**
 * "thịt bò" → "Thịt Bò". Hoa chữ đầu mỗi từ, phần còn lại về chữ thường.
 *
 * Phần còn lại BỊ hạ xuống chữ thường có chủ ý: "THỊT BÒ" gõ nhầm bằng CapsLock phải ra cùng kết
 * quả với "thịt bò", nếu không thì vẫn là hai dòng khác nhau trong danh mục — tức là không giải
 * quyết được đúng cái nó sinh ra để giải quyết.
 *
 * Giữ NGUYÊN khoảng trắng người dùng đang gõ (kể cả khoảng trắng cuối): hàm này chạy trên từng
 * phím bấm, cắt khoảng trắng ở đây thì không gõ được sang từ thứ hai.
 */
export function titleCaseVi(raw: string): string {
  return raw.replace(/\S+/g, (word) => {
    const lower = word.toLocaleLowerCase(VI);
    return lower.charAt(0).toLocaleUpperCase(VI) + lower.slice(1);
  });
}

/** "KG" → "kg". Đơn vị đo viết thường là quy ước chung, và "Kg" cạnh "kg" trong bảng báo cáo chỉ
 *  làm người đọc tưởng là hai đơn vị khác nhau. */
export function lowerUnit(raw: string): string {
  return raw.toLocaleLowerCase(VI);
}
