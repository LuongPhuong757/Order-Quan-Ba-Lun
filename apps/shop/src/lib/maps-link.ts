/**
 * ĐÃ GỠ: `parseMapsLink` + ô "dán link Google Maps" ở `LocationPicker` (2026-08-11, chốt chủ dự
 * án). File này giờ chỉ còn `buildMapsUrl`.
 *
 * Vì sao gỡ: nó là đường thứ ba để làm cùng một việc (nói cho quán biết nhà ở đâu), đứng cạnh
 * nút "Chia sẻ vị trí" và ô nhập địa chỉ tay — trong khi cả đợt sửa 2026-08-11 là để MỖI LÚC CHỈ
 * BÀY MỘT VIỆC. Nó cũng là đường tệ nhất trong ba: khách phải rời app sang Google Maps, nhấn giữ
 * cho ghim hiện ra, copy đúng loại link, quay lại dán — và phần lớn link người ta copy (link tên
 * địa điểm, link kết quả tìm kiếm, link rút gọn `maps.app.goo.gl`) KHÔNG mang toạ độ, nên kết
 * quả thường gặp là một câu báo lỗi ở cuối 4 bước.
 *
 * NẾU AI ĐỊNH DỰNG LẠI: link rút gọn vẫn sẽ không giải được ở client (phải follow redirect), và
 * làm ở server là mở một vector SSRF với URL do khách dán — phải allowlist domain, chặn redirect
 * ra IP nội bộ, timeout ngắn. Đọc 08-RESEARCH.md mục Assumptions Log A3 trước. Bản gỡ nằm ở
 * commit này trong git nếu cần xem lại phần regex.
 */

/**
 * buildMapsUrl — dựng link Google Maps mở ĐÚNG cặp toạ độ sắp gửi cho quán.
 *
 * Đây là cách duy nhất khách tự kiểm tra được vị trí mình vừa chia sẻ là đúng hay lệch: bấm
 * link, thấy ghim rơi vào đúng nhà mình thì yên tâm, lệch thì bấm "Lấy lại vị trí". Trước
 * 2026-08-05 màn checkout chỉ in một dòng chữ "Đã có vị trí của bạn" — khách không có cách
 * nào biết GPS trong nhà/WebView Zalo vừa trả về một điểm cách đó 500m.
 *
 * Dùng dạng Maps URLs API chính thức (`/maps/search/?api=1&query=`) vì nó mở được app
 * Google Maps trên cả iOS/Android và vẫn chạy trên web, thay vì dạng `?q=` cũ.
 */
export function buildMapsUrl(lat: number | string, lng: number | string): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}
