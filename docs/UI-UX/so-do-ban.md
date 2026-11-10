# Màn Order / Sơ đồ bàn — chốt 2026-11-09

Bản xem thử đã duyệt: artifact 8e653eb7 (bản 2). Bằng chứng: artifact 5bbf31b4 (28/28).

## Quyết định
- Bàn xếp THEO SỐ trong từng loại (tại quán → mang về → ship), `localeCompare(numeric)`. Bỏ xếp
  theo toạ độ (y, x): tạo bàn hàng loạt đặt y trùng nhau → 01 11 02 12. Bàn không đổi chỗ khi có khách.
- Header kính mờ (rgba trắng 88% + backdrop blur) — giữ tinh thần "trong suốt" 2026-09-08.
- Điện thoại (< 768px): MỘT dòng báo gộp `PhoneAlertBar` thay 2 dải QR + chưa trả, bấm mở tấm
  "Cần xử lý" (duyệt QR được trong tấm). Áp cả Order lẫn Bếp. iPad/máy tính giữ 2 dải.
  `GuestQrBanner` vẫn dựng suốt để chuông lượt QR mới còn kêu.
- Sheet bàn: thanh dính đáy [＋ Thêm món][Thanh toán]; bỏ nút ＋ tròn nổi và Thanh toán ở đầu.
  KHÔNG thêm bước xác nhận số tiền (Thanh toán chỉ mở hộp chọn hình thức). Màu nút giữ như cũ.
  Esc / bấm vùng tối đóng; Tab giữ trong sheet; đóng trả con trỏ về thẻ bàn. Esc bỏ qua khi đang
  mở hộp con (đếm mọi role="dialog" trên trang).
- BỎ HẲN KiotViet (UI + PATCH /tables/:id/lock + POST /tables/unlock-all + chặn ở tạo đơn / QR /
  cấp bàn online). Cột `kiotviet_locked` GIỮ trong entity (synchronize sẽ drop nếu bỏ).
- `formatAge`: ≥ 24h hiện "N ngày"; thẻ tô đỏ khi ≥ 1 ngày. Bỏ mã `ban-01` trên thẻ. "Trống"
  #6b7280 15px. Tiêu đề "Sơ đồ bàn" BỎ HẲN ở mọi bề rộng (chủ quán đổi lại 2026-11-09 chiều; chỉ
  còn h1 ẩn cho trình đọc màn hình). Máy tính max-width 1200px (~7 cột).
- Header: bỏ "· QUẢN TRỊ", chỉ còn "Quán Bà Lùn" (2026-11-09 chiều).
- Thẻ bàn có lượt QR chờ duyệt: chỉ icon QR + số, bỏ chữ "lượt chờ duyệt" (2026-11-09 chiều).
- Bàn trống chạm 1 lần là vào Gọi món — xem docs/UI-UX/goi-mon.md.
- Menu dưới: thử bản "chỉ icon" → chủ quán thấy rối mắt → GIỮ NGUYÊN như cũ (có chữ, vuốt ngang).
- Header lên TRÊN CÙNG, dải cảnh báo dính ngay DƯỚI header (biến `--header-h`). Logo quán 32px ở
  góc trái header mọi màn (màn Bếp không có header).
- Nhãn trạng thái trên thẻ GIỮ icon + số (đo: đổi sang chữ thì thẻ cao thêm 1 dòng).

## Không làm lần này
- Gom menu còn 5 mục + sidebar máy tính (đợt riêng). Cột chi tiết bàn bên phải trên máy tính.
- Nhãn trạng thái chữ 11px (dưới sàn 15px) — có sẵn, bàn sau.
