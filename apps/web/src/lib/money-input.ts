/**
 * Ô nhập TIỀN có dấu chấm phân cách nghìn — gõ `10000` thì thấy ngay `10.000`
 * (chủ dự án yêu cầu 2026-08-06, cho ô "Phí ship" ở màn duyệt đơn online).
 *
 * Vì sao đáng có: nhập tiền không dấu phân cách là chỗ rất dễ lệch một chữ số — `100000` và
 * `10000` nhìn gần như nhau khi gõ vội, mà sai ở đây là thu nhầm 90.000đ của khách. Dấu chấm làm
 * độ dài con số đọc được bằng mắt, không phải đếm từng chữ số.
 *
 * Hệ quả bắt buộc ở nơi dùng: `<input type="number">` KHÔNG dùng được nữa (nó từ chối hiển thị
 * chuỗi có dấu chấm). Phải là `type="text"` + `inputMode="numeric"` để điện thoại vẫn ra bàn
 * phím số.
 *
 * Quy ước: state của form giữ CHUỖI ĐÃ ĐỊNH DẠNG (thứ khách đang nhìn), và chỉ bóc về số ngay
 * trước khi gửi lên server bằng `digitsOnly`. Làm ngược lại (giữ số thô, format lúc render) thì
 * con trỏ nhảy về cuối ô mỗi lần khách sửa ở giữa chuỗi.
 */

/** Bóc mọi thứ không phải chữ số — dấu chấm, dấu phẩy, khoảng trắng, chữ "đ" khách lỡ gõ. */
export function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, '');
}

/**
 * Chuỗi hiển thị trong ô nhập.
 *
 * Rỗng → rỗng (KHÔNG tự điền `0`): ô trống phải giữ được placeholder, và ô hiện sẵn số 0 thì
 * khách phải xoá nó trước khi gõ số thật.
 */
export function formatMoneyInput(raw: string): string {
  const digits = digitsOnly(raw);
  if (digits === '') return '';
  // `Number` bỏ số 0 vô nghĩa ở đầu: gõ nhầm "0100" ra "100", không phải "0.100".
  return Number(digits).toLocaleString('vi-VN');
}
