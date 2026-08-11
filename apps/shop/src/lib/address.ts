import { findWard, type VnProvince } from '@order/schemas/vn-address';

/**
 * Ghép địa chỉ giao hàng từ 2 ô khách nhập: phần chi tiết (số nhà, thôn, ngõ) + xã đã chọn.
 *
 * MỘT CHỖ DUY NHẤT ghép chuỗi này, vì cả `/checkout` (đặt đơn) lẫn `/cart` (sửa đơn) đều gửi lên
 * cùng một trường `customer_address`. Hai bản ghép trôi khỏi nhau nghĩa là cùng một khách, cùng
 * một nhà, ra hai chuỗi khác nhau ở hai màn — và quán không gộp lại được.
 *
 * `customer_ward_code` vẫn được gửi RIÊNG bên cạnh chuỗi này. Chuỗi là thứ shipper đọc; mã xã là
 * thứ quán lọc/gom tuyến. Không cái nào thay được cái nào: parse ngược tên xã ra khỏi chuỗi thì
 * hỏng ngay lần đầu có khách gõ tên xã vào ô chi tiết.
 *
 * TÊN TỈNH ĐI KÈM vì danh mục nay là toàn quốc chứ không riêng Bắc Ninh — thiếu nó thì "Xã Tân
 * Thành" là một địa chỉ có ở hàng chục tỉnh.
 */

/**
 * Giới hạn ô "số nhà, thôn/xóm" ở trang khách.
 *
 * `customer_address` là `varchar(255)` và `z.string().max(255)`. Chuỗi ghép ra là
 * `"{chi tiết}, {tên xã}, {tên tỉnh}"`, nên phần đuôi ăn tối đa 55 ký tự — tên xã dài nhất cả
 * nước là "Phường Văn Miếu - Quốc Tử Giám" (30) và tên tỉnh dài nhất là "Thành phố Hồ Chí Minh"
 * (21). 190 chừa dư 10 ký tự phòng khi đợt sắp xếp sau sinh ra tên dài hơn.
 *
 * Vì sao không để nguyên 255: khách gõ đủ 255 ký tự rồi bấm Đặt đơn sẽ ăn một lỗi zod ở ĐÚNG cú
 * bấm cuối cùng, sau khi đã điền hết mọi thứ — và câu lỗi nói về `customer_address`, một trường
 * họ chưa từng nhìn thấy. Chặn ở `maxLength` của ô nhập thì họ biết ngay lúc gõ.
 */
export const ADDRESS_DETAIL_MAX = 190;

/**
 * Tên tỉnh dùng trong chuỗi địa chỉ. Bỏ tiền tố "Tỉnh " nhưng GIỮ "Thành phố ": người Việt viết
 * "…, Bắc Ninh" chứ không viết "…, Tỉnh Bắc Ninh", nhưng lại viết đủ "Thành phố Hồ Chí Minh".
 */
export function provinceLabel(province: VnProvince): string {
  return province.name.replace(/^Tỉnh\s+/, '');
}

/** Ghép chuỗi địa chỉ đầy đủ để gửi lên BE. */
export function composeAddress(detail: string, wardCode: string | null): string {
  const head = detail.trim();
  const hit = findWard(wardCode);
  // Chưa chọn xã (khách trình duyệt cũ không render được ô chọn, hoặc luồng sửa đơn cũ) → gửi
  // nguyên phần chi tiết. Địa chỉ thiếu xã vẫn giao được; đơn không gửi được thì không.
  if (!hit) return head;
  return [head, hit.ward.name, provinceLabel(hit.province)].filter(Boolean).join(', ');
}

/**
 * Tách ngược chuỗi đã ghép về phần chi tiết, để màn sửa đơn ở `/cart` prefill đúng ô.
 *
 * Chỉ cắt khi đuôi khớp CHÍNH XÁC tên xã + tỉnh của `wardCode` — đơn cũ (ghép tay, chưa có mã xã)
 * thì trả nguyên chuỗi. Đoán mò ở đây là mỗi lần khách mở màn sửa lại mất một mẩu địa chỉ.
 */
export function extractAddressDetail(full: string | null, wardCode: string | null): string {
  if (!full) return '';
  const hit = findWard(wardCode);
  if (!hit) return full;
  const suffix = `, ${hit.ward.name}, ${provinceLabel(hit.province)}`;
  return full.endsWith(suffix) ? full.slice(0, -suffix.length) : full;
}
