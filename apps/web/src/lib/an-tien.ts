// Che số tiền trong câu nhật ký bàn cho nhân viên Order/Bếp (chủ quán chốt 2026-10-20).
//
// Nhật ký bàn do BE viết sẵn thành câu, và câu thanh toán có nhét tiền vào giữa ("Thanh toán:
// 350.000đ (5 món đã giao) · tiền mặt"). Nhân viên được đọc NHẬT KÝ (ai gọi, ai huỷ, ai trả bàn)
// nhưng tuyệt đối không được thấy số tiền — thấy từng bàn thì tự cộng ra doanh thu.
//
// Che ở FE chứ không bỏ ở BE là chủ quán chọn: ở quán không ai mở công cụ trình duyệt, còn BE
// vẫn phải trả câu đầy đủ cho admin. Mọi số tiền BE viết ra đều qua `fmtVnd` / `fmt` =
// `toLocaleString('vi-VN') + 'đ'` → luôn có dạng "1.234.567đ", nên một regex là bắt đủ.

const TIEN = /-?\d{1,3}(?:\.\d{3})*đ/g;

export function anTien(message: string): string {
  return message.replace(TIEN, '•••');
}
