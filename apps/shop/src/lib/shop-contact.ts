/**
 * Thông tin liên hệ của quán hiện ở footer trang khách.
 *
 * Vì sao là hằng số trong code chứ không đọc từ API/DB: đây là dữ liệu gần như
 * không đổi, và footer phải hiện được NGAY cả khi `/api/public/*` lỗi (khách
 * không tải được menu thì càng cần số điện thoại để gọi trực tiếp). Đổi thông
 * tin = sửa file này rồi build lại.
 *
 * MỖI Ô ĐỂ RỖNG THÌ FOOTER TỰ ẨN DÒNG ĐÓ — không bao giờ hiện số điện thoại
 * giả hay link chết ra trang khách. Chủ quán điền giá trị thật vào đây.
 */
export type ShopContact = {
  /** Địa chỉ đầy đủ, một dòng. Rỗng = ẩn dòng địa chỉ. */
  address: string;
  /** Số điện thoại dạng khách đọc được, ví dụ "0912 345 678". Rỗng = ẩn. */
  phone: string;
  /**
   * Số dùng cho link Zalo — CHỈ chữ số, không dấu cách, ví dụ "0912345678".
   * Rỗng = ẩn nút Zalo. Nếu quán dùng Zalo OA thì điền `zaloUrl` thay vì số này.
   */
  zaloPhone: string;
  /** Link Zalo đầy đủ (Zalo OA / link mời). Ưu tiên hơn `zaloPhone` nếu có. */
  zaloUrl: string;
  /** URL trang Facebook của quán. Rỗng = ẩn nút Facebook. */
  facebookUrl: string;
};

// TODO(chủ quán): điền 4 ô dưới đây bằng thông tin thật rồi build lại.
// Đang rỗng nên footer chỉ hiện tên quán — thà thiếu còn hơn hiện tin sai.
export const SHOP_CONTACT: ShopContact = {
  address: '',
  phone: '',
  zaloPhone: '',
  zaloUrl: '',
  facebookUrl: '',
};

/** Chuẩn hoá số điện thoại thành dạng dùng được cho `href="tel:"`. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

/**
 * Link mở app/trang bản đồ ở địa chỉ quán. Dùng endpoint `search` chính thức
 * của Google Maps thay vì tự ghép toạ độ: địa chỉ chữ luôn mở được trên cả
 * iOS, Android và desktop, không cần biết lat/lng.
 */
export function mapsSearchHref(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

/** Link chat Zalo, hoặc `null` nếu quán chưa khai báo Zalo. */
export function zaloHref(contact: ShopContact): string | null {
  if (contact.zaloUrl) return contact.zaloUrl;
  const digits = contact.zaloPhone.replace(/\D/g, '');
  return digits ? `https://zalo.me/${digits}` : null;
}
