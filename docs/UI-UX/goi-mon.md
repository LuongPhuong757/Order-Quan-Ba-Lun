# Gọi món · Giỏ · Thanh toán — chốt 2026-11-09

Bản xem thử đã duyệt: artifact cea4edef (bản 2 — bộ − số + thu nhỏ).

## Quyết định
- **Bàn trống chạm 1 lần là vào Gọi món** (`OrderDrawer` prop `goiMonNgay`). Đóng Gọi món mà chưa
  gửi gì → đóng luôn tấm bàn. Bàn có món, bàn có lượt QR chờ duyệt, mở qua link `?table=` → vẫn
  mở tấm bàn như cũ.
- **Thẻ món gọn**: bỏ mã SP (vẫn tìm theo mã) + dòng "nhóm · đơn vị"; giá kèm đơn vị
  ("35.000đ / ca"); tên 16px; thẻ chưa chọn ~72px (trước 102px).
- **Bộ − số + dùng chung** `components/ui/QtyStepper.tsx` (`.ds-qty`): viên thuốc cao 34px viền
  vàng mảnh, KHÔNG nền đặc (bản 44px nút đặc bị chê "quá to"); vùng bấm vẫn ~44px nhờ `::after`.
  Dùng ở dòng giỏ. Trên THẺ MÓN dùng kiểu `kieu="thanh"` (artifact 89a82a15, phương án A —
  viên thuốc + chữ "Ghi chú" trên thẻ 140px rớt 2 dòng, bị chê "quá xấu"): thanh vàng nhạt trải
  hết đáy thẻ, nửa trái −, nửa phải +. Ghi chú = nút bút 34px góc trên phải (có ghi chú → bút
  xanh + nội dung một dòng dưới giá). Lưới `align-items: start` để thẻ hết món không bị kéo cao.
  Món hết: viền đứt + tên gạch ngang, không làm mờ cả thẻ.
- **Bấm − về 0 hỏi "Bỏ món này?"** (cả thẻ lẫn giỏ); bỏ nút "🗑 Xoá" từng món.
- **"Xoá hết" vào menu ⋯** ở đầu giỏ, luôn hỏi lại (trước là nút đỏ sát ✕ đóng giỏ).
- **Món hết**: mờ 45%, nền xám, xuống cuối nhóm (đang tìm: cuối danh sách), không chạm được —
  `dayMonHetXuongCuoi()` trong `lib/menu-search.ts`, có test.
- **Ô tìm**: `type=search` + `enterKeyHint=search`, gợi ý "Tìm món, mã, viết tắt (ktl)". Vẫn GIỮ
  chữ + bôi đen sau khi chọn món (quy tắc 2026-09-19), nút ✕ to có sẵn; ẩn ✕ nhỏ mặc định của
  trình duyệt.
- **Đếm thống nhất "2 món (6 phần)"** ở giỏ, đầu tấm giỏ và hộp Thanh toán (trước hộp ghi "6 món").
- **Nút đáy màn Gọi món**: "Xem đơn · 6 · 50.000đ".
- **Thanh toán — chạm hình thức là đi tiếp**: Chuyển khoản / Cả hai → sang màn QR; Tiền mặt →
  CHỐT LUÔN (không bước xác nhận); Ghi nợ → ở lại gõ "ai nợ" rồi bấm "Xác nhận ghi nợ".
- **Thanh toán = tấm trượt đáy** trên điện thoại (`.pay-sheet`, đệm safe-area); iPad/máy tính tấm
  nổi cách đáy 24px.

## Rủi ro đã biết
- Chạm nhầm "Tiền mặt" là đóng bàn ngay — chủ quán chấp nhận đổi lấy 1 chạm.

## Nghiệm thu (390 · 820 · 1280)
- Thẻ chưa chọn không có chữ < 15px; thẻ đã chọn có bộ − số + và "Ghi chú" trên một hàng.
- Bộ − số + không chồng lên giá/tên ở thẻ 140px.
- Hộp Thanh toán điện thoại dính đáy, nút không bị thanh home iPhone che.

## Cập nhật 2026-11-09 chiều — tách dáng theo thiết bị
- **Điện thoại (< 768px): DANH SÁCH** theo mẫu app chủ quán đưa (artifact fac4236c): mỗi món một
  hàng [ảnh 56px (thumb, lỗi thì ảnh gốc; không ảnh → icon)] [tên đậm / giá + đơn vị / ghi chú]
  [nút + 44px | đã chọn: QtyStepper viên thuốc + "＋ Ghi chú"]; ảnh có dấu ✓ khi đã chọn.
  Đầu màn MỘT hàng [Bàn 05][ô tìm][✕], bỏ chữ "Gọi món". Đáy [Chọn lại (hỏi lại)][Xem đơn ·
  tổng tiền (số phần)].
- **iPad/máy tính (≥ 768px): LƯỚI THẺ**, thẻ ≥ 170px (~3 thẻ/hàng), tên tối đa 3 dòng, thẻ cùng
  hàng cao bằng nhau; món đã chọn CHỈ có con số cam ở góc (giỏ bên phải lo − số + và ghi chú).
- Khung thẻ `overflow: clip` (KHÔNG hidden): hidden + content-visibility + stretch = lưới sụp còn
  2px/thẻ (đo Chrome headless 600 thẻ).
- Bỏ kiểu `kieu="thanh"` của QtyStepper (phương án A) — không còn dùng.
- 2026-11-09 tối: QtyStepper thu còn 30px (34px bị chê "vẫn to"), vùng chạm ::after 7px; nút + hàng danh sách 38px. Cam → xanh ngọc (--brand) toàn màn Gọi món/giỏ; giỏ 2 cột (giá + − số + bên phải).
