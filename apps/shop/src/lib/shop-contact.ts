/**
 * Thông tin liên hệ của quán hiện ở footer trang khách.
 *
 * Từ 2026-08-04, nguồn CHÍNH là `store_address` / `store_phone` /
 * `store_facebook_url` / `store_zalo` trong `GET /api/public/store` — chủ quán
 * sửa ở /admin (khối "Thông tin quán") là trang khách ăn ngay, không cần build
 * lại (tiền lệ D-14). Hằng số `SHOP_CONTACT` bên dưới trở thành FALLBACK
 * từng-ô: footer vẫn hiện được ngay khi API chưa về hoặc lỗi (khách không tải
 * được menu thì càng cần số điện thoại để gọi trực tiếp) — xem `mergeShopContact()`.
 *
 * MỖI Ô RỖNG (cả ở settings lẫn fallback) THÌ FOOTER TỰ ẨN DÒNG ĐÓ — không bao
 * giờ hiện số điện thoại giả hay link chết ra trang khách.
 */
export type ShopContact = {
  /** Địa chỉ đầy đủ, một dòng. Rỗng = ẩn dòng địa chỉ (trừ khi có `addressUrl`). */
  address: string;
  /**
   * Link Google Maps CHÍNH XÁC của quán (link chia sẻ / maps.app.goo.gl) — ưu
   * tiên hơn tự search theo chữ `address`, vì pin chia sẻ trỏ đúng quán còn
   * search theo chữ có thể ra nơi trùng tên. Xem `mapsHref()`.
   */
  addressUrl: string;
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
  /** URL trang Instagram của quán. Rỗng = ẩn nút Instagram. */
  instagramUrl: string;
};

// Fallback khi `/api/public/store` chưa về / lỗi — chủ quán cung cấp 2026-08-04.
// `address` là chữ hiển thị (theo reverse-geocode toạ độ quán — chưa có số nhà/tên
// đường); link bấm vào là `addressUrl` pin đúng quán nên chữ chỉ cần đủ nhận ra khu vực.
// Nguồn chính vẫn là /admin (khối "Thông tin quán") — điền ở đó sẽ đè lên các ô này.
export const SHOP_CONTACT: ShopContact = {
  address: 'Phường Nếnh, TP. Bắc Ninh',
  addressUrl: 'https://maps.app.goo.gl/qhyxTeDcqfKzDnFFA',
  phone: '',
  zaloPhone: '0338865217',
  zaloUrl: '',
  facebookUrl: 'https://www.facebook.com/san.huyen.5',
  instagramUrl: '',
};

/** Đúng 4 field footer cần từ `GET /api/public/store` — không kéo cả PublicStoreStatus
 * vào đây để module này vẫn test được thuần, không phụ thuộc schema. */
export type StoreContactFields = {
  store_address: string;
  store_phone: string;
  store_facebook_url: string;
  store_instagram_url: string;
  store_zalo: string;
};

/**
 * Ghép settings từ API đè lên fallback `SHOP_CONTACT`, TỪNG Ô MỘT: ô nào chủ
 * quán đã điền ở /admin thì thắng, ô nào rỗng (hoặc API chưa về — `api = null`)
 * thì rơi về hằng số. 2 ô "nhận cả 2 dạng":
 * - `store_zalo`: bắt đầu bằng http(s) → link Zalo OA, còn lại coi là số
 *   điện thoại (zaloHref tự lọc ký tự thừa).
 * - `store_address`: dán link Google Maps → vào `addressUrl` (chữ hiển thị do
 *   Footer tự thay bằng nhãn chung), gõ chữ → địa chỉ hiển thị + search.
 */
export function mergeShopContact(api: StoreContactFields | null): ShopContact {
  if (!api) return SHOP_CONTACT;
  const zalo = api.store_zalo.trim();
  const zaloFields = zalo
    ? /^https?:\/\//i.test(zalo)
      ? { zaloUrl: zalo, zaloPhone: '' }
      : { zaloUrl: '', zaloPhone: zalo }
    : { zaloUrl: SHOP_CONTACT.zaloUrl, zaloPhone: SHOP_CONTACT.zaloPhone };
  const addr = api.store_address.trim();
  const addressFields = addr
    ? /^https?:\/\//i.test(addr)
      ? { address: '', addressUrl: addr }
      : { address: addr, addressUrl: '' }
    : { address: SHOP_CONTACT.address, addressUrl: SHOP_CONTACT.addressUrl };
  return {
    phone: api.store_phone.trim() || SHOP_CONTACT.phone,
    facebookUrl: api.store_facebook_url.trim() || SHOP_CONTACT.facebookUrl,
    instagramUrl: api.store_instagram_url.trim() || SHOP_CONTACT.instagramUrl,
    ...addressFields,
    ...zaloFields,
  };
}

/** Link mở bản đồ: ưu tiên link pin chính xác, không có thì search theo chữ.
 * `null` = không có gì để mở → Footer ẩn dòng địa chỉ. */
export function mapsHref(contact: ShopContact): string | null {
  if (contact.addressUrl) return contact.addressUrl;
  return contact.address ? mapsSearchHref(contact.address) : null;
}

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
