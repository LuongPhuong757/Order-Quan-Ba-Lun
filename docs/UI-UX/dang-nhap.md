# Màn Đăng nhập — chốt 2026-11-09

Bản xem thử đã duyệt: artifact eec0df54. Góp ý gốc: rà soát UI trang quản trị 2026-11-09.

## Giao diện
- Thẻ căn giữa màn theo chiều dọc (`100dvh`), lề 2 bên ≥ 16px.
- Logo `favicon.svg` 48px · "Quán Bà Lùn" · "Trang quản trị · Đăng nhập để quản lý quán".
- Nút Đăng nhập KHÔNG mờ khi ô trống (autofill iPhone không bắn sự kiện → nút mờ oan). Bấm mà thiếu
  thì báo dưới ô (`role="alert"`), con trỏ nhảy vào ô thiếu. Đọc giá trị thẳng từ ô khi gửi.
- Bỏ kiểm "tối thiểu 8 ký tự" lúc đăng nhập (cả FE lẫn `LoginDto` → MinLength(1)).
- Lỗi máy chủ (sai mật khẩu, tài khoản dừng, khoá 15 phút) → khung đỏ cố định trên nút, không toast.
- Đang gửi: vòng xoay + "Đang đăng nhập…", khoá nút (bấm 3 lần chỉ gửi 1).
- Ô `name`/`required`, cao 48px; nền autofill trắng. Nút mắt 44×44, `aria-pressed` (PasswordInput chung).

## Logic (bàn riêng, commit riêng)
- BỎ "Quên mật khẩu / mã khôi phục": trang /recover, API POST /auth/recover, mã sinh lúc /setup.
  Bảng `recovery_codes` giữ nguyên. Nhân viên quên → admin đặt lại; chủ quán quên → script trên server.
- Cookie `SameSite=Lax` (trước Strict): mở trang từ link ngoài vẫn giữ đăng nhập. CSRF vẫn chặn bằng
  kiểm Origin (`common/csrf-paths.ts`).
- `JWT_LIFETIME_DAYS` mặc định trong docker-compose 7 → 3650 (khớp quyết định "vĩnh viễn" 2026-09-19).
  ⚠ `.env` trên VPS có ghi biến này thì vẫn thắng — phải kiểm tay.

## Giới hạn đã biết
- Safari: tab riêng tư, icon màn hình chính, trình duyệt trong Zalo là ngăn cookie RIÊNG (Apple) —
  mỗi ngăn đăng nhập 1 lần.
- Trình duyệt cắt cookie tối đa ~400 ngày. Muốn vĩnh viễn thật cần "tự gia hạn" — CHƯA làm, chờ chủ quán.

## Nghiệm thu (đạt 2026-11-09, 14/14 bước, 390 · 820 · 1280)
