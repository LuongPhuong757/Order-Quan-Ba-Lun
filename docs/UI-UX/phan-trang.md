# Thanh chuyển trang — chốt 2026-11-09

## Vấn đề
Mọi danh sách chỉ có "← Trước / Sau →". Sang trang 12 phải bấm 11 lần. Có 3 kiểu viết khác
nhau (inline ở Lịch sử/Menu, `.sx-pager` ở Sổ tiền, `Pager` ở NCC/Món bán).
Chủ quán lật trang để: tìm đơn cũ, xem lần lượt, nhảy về trang cuối — chủ yếu ở Lịch sử.

## Quyết định
- Component chung `components/ui/Pagination.tsx` (logic `lib/phan-trang.ts`, có test).
  `components/Pager.tsx` chỉ còn là lớp bọc cho các bảng cắt trang ở client.
- Máy tính/iPad: `‹ Trước 1 … 9 10 11 … 24 Sau ›`. Điện thoại (tối giản): `‹ 1 … 10 … 24 ›`.
- Bấm "…" hoặc dòng "Đang xem 181–200 / 480 đơn" → **lưới chọn trang** số to (5 cột, nút 48px)
  + "Trang đầu / Trang cuối". Điện thoại trượt từ đáy, ≥ 768px là hộp giữa màn. Trang bất kỳ = 2 chạm.
- Chỉ đặt ở CUỐI danh sách (chủ quán bỏ thanh phía trên). Đổi trang tự cuộn về đầu danh sách.
- Ẩn khi chỉ có 1 trang.
- Lịch sử nhớ bộ lọc + khoảng ngày + trang tới khi đóng tab (`lib/nho-loc.ts`, sessionStorage,
  khoá theo người dùng). Ca đã sang ca mới / "Hôm nay" sang ngày mới → tự về trang 1.

## Phương án bỏ
- Chỉ dãy số: trang xa vẫn 3–4 chạm.
- Ô gõ số trang: phải mở bàn phím, người lớn tuổi bất tiện.
- Nhớ mỗi số trang (không nhớ bộ lọc): trang 10 thành dữ liệu khác.

## Nghiệm thu (đã đạt 2026-11-09, artifact cd6f76ea)
390 · 820 · 1280: thanh không tràn, nút ≥ 44px, lưới mở đúng kiểu, máy chủ nhận đúng `page`.

## Còn lại (ngoài phạm vi)
- Bảng đơn Lịch sử tràn ngang ở iPad 820 (cột khai cứng ~1.180px) — có từ trước, để Đợt 4.
- Màn Sổ món (`MenuBookPanel`) là trang IN, không phải danh sách — không đổi.
