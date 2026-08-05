/**
 * customerMapHref — link bản đồ để nhân viên/shipper mở vị trí khách, dựng từ dữ liệu đơn.
 *
 * Vì sao cần hàm này (2026-08-05): màn quản lý đơn trước đây chỉ hiện nút "Mở bản đồ" khi
 * `customer_map_link` có giá trị, mà field đó CHỈ được set khi khách dán link Google Maps.
 * Khách bấm nút "Chia sẻ vị trí" — đường chính, GPS thật — thì map_link là null, nên đơn có
 * toạ độ chính xác nhất lại là đơn không mở được bản đồ. Giờ thiếu map_link thì dựng link từ
 * `customer_lat/lng`.
 *
 * Chốt thứ hai: `customer_map_link` là CHUỖI DO KHÁCH DÁN, không phải URL đã kiểm. Khách hay
 * dán thẳng cặp số "10.76, 106.66" (parseMapsLink phía shop nhận dạng này) — nhét nguyên vào
 * `href` là ra link tương đối, bấm vào đi lạc trong trang admin. Nên chỉ dùng map_link khi nó
 * thật sự là http(s), còn lại quay về toạ độ.
 */

/** Field khai OPTIONAL để dùng được cho cả 2 nguồn: hàng đơn online (`AdminOnlineOrderRow`, đủ
 *  field) và entity `orders` ở drawer bàn (type FE khai optional vì BE trả nguyên entity). */
export type CustomerMapSource = {
  customer_map_link?: string | null;
  customer_lat?: string | null;
  customer_lng?: string | null;
};

function isHttpUrl(raw: string): boolean {
  const trimmed = raw.trim();
  return trimmed.startsWith('https://') || trimmed.startsWith('http://');
}

export function customerMapHref(row: CustomerMapSource): string | null {
  if (row.customer_map_link && isHttpUrl(row.customer_map_link)) {
    return row.customer_map_link.trim();
  }
  if (row.customer_lat && row.customer_lng) {
    // Dạng Maps URLs API chính thức — mở được app Google Maps trên điện thoại shipper.
    return `https://www.google.com/maps/search/?api=1&query=${row.customer_lat},${row.customer_lng}`;
  }
  return null;
}
