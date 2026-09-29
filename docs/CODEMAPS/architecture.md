<!-- Sinh: 2026-09-29 | Nhánh: chore/claude-context | 42 controller, 37 bảng, 452 file TS -->

# Kiến trúc tổng

## Ba mặt, một API

```
                      ┌──────────────────────────┐
  Nhân viên/chủ quán  │ apps/web   (Vite :5173)  │  admin.quanbalun.site
  (POS, bếp, kho)     └────────────┬─────────────┘
                                   │ tiền tố TRẦN: /auth /orders /menu /admin …
                                   ▼
                      ┌──────────────────────────┐        ┌─────────┐
                      │ apps/api  (Nest :3001)   │───────▶│ MySQL 8 │
                      └────────────▲─────────────┘        └─────────┘
                                   │ tiền tố /api/public/* và /api/admin/*
  Khách (đặt online,  ┌────────────┴─────────────┐
   QR gọi món tại bàn)│ apps/shop  (Vite :5174)  │  quanbalun.site
                      └──────────────────────────┘
```

API phục vụ luôn file tĩnh của cả hai FE. [apps/api/src/main.ts:26](../../apps/api/src/main.ts#L26)
chọn bundle theo **tiền tố host**: `admin.*` → `web-dist/`, **mọi host còn lại** → `shop-dist/`.
Chiều mặc định là cố ý — host lạ (vào thẳng bằng IP, Host header rác) ra trang khách, không ra
trang quản lý. Trên VPS, Caddy đứng trước và phân domain.

## Ranh giới rõ ràng

| Tầng | Ai được gọi | Xác thực |
|---|---|---|
| `modules/public/*` | Khách vô danh | Token đơn (`:token`) + OTP điện thoại |
| `modules/suppliers/supplier-portal` | Nhà cung cấp | Phiên riêng (`supplier_sessions`) |
| Còn lại | Nhân viên / chủ quán | JWT 7 ngày, cookie HttpOnly + JTI blacklist |

Ba hệ danh tính **tách biệt** — `users`, `supplier_users`, `customer_sessions`. Đừng trộn guard
giữa chúng.

## Chuỗi middleware / guard (BE)

```
request
  → cookie-parser
  → csrf-origin.middleware.ts      ⚠ thiếu header Origin thì POST/PATCH trả 403
  → request-id.middleware.ts
  → read-only-throttler.guard.ts   (hạn mức riêng cho GET)
  → Jwt / Role guard
  → Controller
  → GlobalExceptionFilter          (ghi đè message theo mã — xem FRIENDLY_VN)
```

## Luồng dữ liệu chính — một đơn tại bàn

```
Khách quét QR  →  shop /thuc-don  →  POST /api/public/orders
                                          │
                                          ▼
                              online_order_requests (chờ duyệt)
                                          │  nhân viên bấm duyệt
                                          ▼
   web /orders  ──▶  orders + order_items  ──▶  print_jobs ──▶ cầu in (/print-bridge)
                            │                        (WebUSB tại quán)
                            ├──▶ order_item_ingredient_usage  (trừ kho theo công thức)
                            └──▶ payment_intents ──▶ bank_transactions (webhook SePay)
```

## Nơi đặt kiểu dữ liệu

`packages/schemas` là **nguồn sự thật** cho kiểu FE↔BE (Zod, 19 file). BE validate bằng nó, FE
parse response bằng nó. Thêm trường mới thì sửa ở đây trước, đừng khai hai lần.

## Bản đồ chi tiết

- Routes + module BE → [backend.md](backend.md)
- Trang + state FE → [frontend.md](frontend.md)
- Bảng + quan hệ → [data.md](data.md)
- Dịch vụ ngoài → [dependencies.md](dependencies.md)
