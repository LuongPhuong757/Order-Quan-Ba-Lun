<!-- Sinh: 2026-09-29 | 3 app + 2 package nội bộ -->

# Phụ thuộc & dịch vụ ngoài

## Package nội bộ

| Package | Dùng bởi | Vai trò |
|---|---|---|
| `@order/schemas` | api, web, shop | **Nguồn sự thật** kiểu FE↔BE (Zod, 19 file) |
| `@order/utils` | api | Tiện ích chung |

⚠ Sửa `packages/*` thì **phải build lại** trước khi typecheck app thấy thay đổi. Turbo cache
**dùng chung giữa các worktree** — worktree mới có thể ăn cache hit của worktree khác, tự kiểm
`dist/` có thật không.

`packages/schemas/src/` gồm: `auth` `admin` `menu` `orders` `tables` `errors`
`public-menu` `public-orders` `public-otp` `public-store` `public-top-dishes`
`admin-online-orders` `payment-code` `payment-qr` `vietqr-payload` `ship-fee`
`transfer-note` `vn-address`.

`vn-address.ts` do **script sinh ra**, không sửa tay. Thêm tỉnh thì thêm vào `GEOCODE_PROVINCES`
+ `BBOX` rồi chạy script (~15 phút, all-or-nothing).

## Backend — thư viện chính

```
@nestjs/*           common core config typeorm swagger schedule throttler event-emitter
typeorm + mysql2    ORM + driver
zod                 validate (qua @order/schemas)
class-validator     validate DTO
bcrypt              băm mật khẩu
jsonwebtoken        JWT 7 ngày trong cookie HttpOnly
sharp               xử lý ảnh tải lên
@napi-rs/canvas     render hoá đơn thành ảnh để in
multer              nhận file
pino + nestjs-pino  log
```

## Frontend

| | `apps/web` | `apps/shop` |
|---|---|---|
| Khung | react 19, react-router-dom | react 19, react-router-dom |
| Gọi API | **axios** | `fetch` trần |
| Bản đồ | leaflet | leaflet |
| Khác | `qrcode`, `xlsx` (xuất Excel), `zxcvbn` (đo mạnh yếu mật khẩu) | — |

Không có thư viện state, không có UI kit — CSS viết tay (`styles.css`, `suppliers-ui.css`).

## Dịch vụ ngoài

| Dịch vụ | Dùng để | Trạng thái |
|---|---|---|
| **SePay** | Webhook báo tiền chuyển khoản về → `bank_transactions` | Đang chạy. Gọi **thẳng API**, không qua Vite |
| **VietQR** | Sinh payload QR thanh toán | Đang chạy |
| **MISA CukCuk** | Đẩy đơn sang phần mềm kế toán | Đang làm — spec `docs/MILESTONE-05`. Cổng API **không ghi được hoá đơn**, chỉ đẩy được ĐƠN |
| **GA4 / gtag** | Đo traffic trang khách | Đang chạy. Luôn đếm **thiếu** vì 2/3 nút quảng cáo không qua web |
| **OpenStreetMap** | Tile bản đồ Leaflet | ⚠ `openstreetmap.org` bị chặn DNS (trỏ 127.0.0.1) → dùng `openstreetmap.de`. **Nominatim sẽ chết** |
| **Telegram** | Báo cáo VPS hàng tuần (systemd timer 10h05 thứ 2) | Ngoài repo — script ở `/usr/local/lib/ordbl-report` trên VPS |

## Hạ tầng

```
Docker Compose      docker-compose.yml / .dev.yml / .prod.yml
Caddy               Caddyfile / Caddyfile.dev — TLS + phân domain
GitHub Actions      ci.yml (dùng chung) → deploy.yml (production) / deploy-develop.yml (dev)
deploy.sh           đường deploy tay, CI gọi lại chính nó (không dựng đường thứ hai)
fail2ban            bật 2026-09-09 — IP nhà đổi là có thể tự ban, bantime 1h
```

⚠ **VPS ↔ github.com chập chờn**: TCP 443 fail ~40%. Mọi lệnh git **trên server** phải retry.
Đỏ ở `fetch`/`pull` là **mạng**, không phải code.

⚠ Build cache Docker ở `/var/lib/containerd` làm đầy ổ — prune định kỳ, **cấm `--volumes`**.

## Cấu hình

| File | Ghi chú |
|---|---|
| `.env.example` | Mẫu dev local |
| `.env.production.example` | Mẫu production |
| `docs/env.dev.example` | Mẫu stack develop — tên **không** bắt đầu bằng `.env` vì `.gitignore` nuốt mọi `.env.*` |

File `.env` thật **không nằm trong git**. Trên VPS: `/opt/ordbl-dev/.env.dev` cho stack dev.
