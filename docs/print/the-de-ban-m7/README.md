# Thẻ để bàn A5 — gọi món tại bàn (M7)

Thẻ hai mặt, dựng giá mica.
- Mặt trước có **một** mã QR, trỏ tới `https://menu.quanbalun.site`.
- Mặt sau hướng dẫn 4 bước theo luồng M7: nhập số bàn → chọn món → gửi cho quán → quán xác nhận.

**Chỉ in sau khi M7 đã lên production.** Trước thời điểm đó, khách quét mã sẽ không thấy luồng như hướng dẫn trên thẻ.

## File

| File | Dùng để |
|---|---|
| `the-de-ban-a5.pdf` | Gửi nhà in: A5, 2 trang, in hai mặt, lật theo cạnh dài |
| `the-de-ban-a5.html` | Bản tự chứa (font, logo, ảnh, QR SVG). Mở bằng Chrome/Edge rồi Ctrl+P |
| `template.html` + `build.cjs` | Nguồn để sửa. Sửa xong chạy `node docs/print/the-de-ban-m7/build.cjs` từ checkout chính (cần gói `qrcode` của apps/web) |
| `img/*.jpg` | Ảnh chụp màn hình thật trên develop (`menu.dev.quanbalun.site`, 2026-10-10), khung 390×844 @3x, nút cần bấm khoanh vàng |
| `assets/` | Font Baloo 2 / Be Vietnam Pro và logo, lấy từ tấm A5 cũ |

## Trước khi in lại

- `curl` cả hai địa chỉ QR trên production, phải trả về 200. Sau đó giải mã ngược ảnh QR đã render (pngjs + jsqr) để chắc nội dung đúng. QR đã in ra thì không sửa được.
- Giao diện app thực đơn có thay đổi (đổi chữ trên nút, đổi vị trí) thì chụp lại ảnh trong `img/` cho khớp.
