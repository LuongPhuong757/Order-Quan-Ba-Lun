<!-- Sinh: 2026-09-29 | 18 module, 42 controller | apps/api -->

# Backend — `apps/api`

NestJS 10 + TypeORM + MySQL 8. **Không có migration**: schema dựng bằng `synchronize` từ mảng
entity tường minh trong [src/data-source.ts](../../apps/api/src/data-source.ts). Entity không khai
ở đó → `tsc` xanh nhưng bảng không được tạo.

⚠ Thêm controller mới thì **phải** thêm tiền tố vào proxy của
[apps/web/vite.config.ts](../../apps/web/vite.config.ts), không thì dev server trả `index.html`.

## Routes theo module

### Xác thực & thiết lập
```
auth        POST /auth/login  /logout  /change-password  /recover    GET /auth/me
setup       GET|POST /setup                        (chỉ chạy lần đầu, chặn theo IP)
health      GET /health
admin/users POST /  GET /  PATCH /:id  DELETE /:id
            POST /:id/reset-password  /:id/disable  /:id/enable
admin/audit GET /  GET /export.csv
```

### Bán hàng — POS
```
orders   GET  /  /open-count  /open-table-ids  /kitchen-count  /by-table/:tableId
         GET  /history  /payment-summary  /stats  /cashiers  /:id/activity
         POST /:id/items  /:id/items-bulk  /:id/notes  /:id/send-to-kitchen
         POST /:id/cancel-all  /:id/checkout  /:id/settle-debt  /:id/print  /:id/transfer
         PATCH /items/:itemId/state  /items/:itemId/priority  /:id/debt
               /:id/misa  /:id/customer-info
         POST /items/remove
orders   GET|POST /:id/payment-photos   DELETE /payment-photos/:photoId   (ảnh bill CK)
tables   GET /  POST /  /bulk  /unlock-all   PATCH /:id  /:id/lock   DELETE /:id
dish-sales GET /  /orders
```

### Thực đơn & kho
```
menu         GET /  /version   POST /  /upload-image  /bulk-import  /:id/toggle-stock
             PATCH /:id   PUT /book-order   DELETE /:id
menu-groups  GET /  POST /  PATCH /:id  DELETE /:id
ingredients  GET /  POST /  PATCH /:id  DELETE /:id  POST /:id/merge
recipes      GET /counts  /:menuItemId   POST /:menuItemId/lines   DELETE /lines/:lineId
consumption  GET /
```

### Nhà cung cấp
```
suppliers            GET /  /:id  /:id/items  /:id/account   POST /   PATCH /:id
                     PUT /:id/account   DELETE /:id  /:id/account
suppliers (công nợ)  GET /balances/all  /:id/balance  /:id/payments
                     POST /:id/payments   PUT /:id/opening-balance
                     DELETE /payments/:paymentId
supplier-deliveries  GET /  /:id  /:id/photos   POST /  /:id/confirm  /:id/photos  /:id/cancel
                     PUT /:id   DELETE /photos/:photoId
supplier-reports     GET /pairs /food-cost /daily /deliveries /payments /matrix /history
supplier-portal      POST /login /logout /deliveries   GET /me /items /deliveries
```

### Đặt online & khách (tiền tố `/api/public`)
```
api/public   GET  /menu  /menu-book  /store  /top-dishes  /health  /orders/:token
             POST /orders  /orders/lookup  /ship-quote  /geo-log
             PATCH|DELETE /orders/:token
api/public/otp         POST /request  /verify
api/public/menu-photos GET /:token   POST /:token/:itemId
api/public/track       POST /                      (đo traffic)
admin/online-orders    GET /   POST /:id/confirm /reject /cancel /fulfillment /ship /receive
                       POST /by-order/:orderId/ship  /receive   PATCH /:id/items
```

### Thanh toán
```
payments    GET /reconcile  /transactions  /intent/:code    POST /intent
webhooks    POST /sepay                     ⚠ SePay gọi thẳng API, KHÔNG qua Vite
payment-qr        GET /                     (tài khoản QR đang bật)
admin/payment-qr  GET /  POST /  /upload-image  PATCH /:id  DELETE /:id
```

### In ấn
```
print         POST /next  /jobs/:id/ack  /jobs/:id/fail    (cầu in kéo việc)
print-pair    POST /                                        (ghép máy in)
admin/print   GET /overview   POST /devices  /devices/:id/revoke  /test
```

### Cấu hình & thống kê
```
admin/settings         GET /  PUT /
admin/phone-blacklist  GET /  POST /  DELETE /:phone
admin/analytics        GET /traffic  /customers  /carts
```

## Module không có controller

`maintenance`, `notifications` — chạy nền: cron dọn dẹp và `notification_outbox` (OutboxPoller,
nhịp 15s; log `Connection lost` lặp mỗi 15s là dấu hiệu Docker treo, không phải lỗi code).

## CLI

```
seed:owner            tạo tài khoản chủ quán
seed:demo             seed menu + bàn mẫu
schema:verify         đối chiếu entity ↔ schema thật
preview:receipt       render thử hoá đơn
cron:audit-retention  dọn audit log cũ
cron:jti-cleanup      dọn JTI đã thu hồi
```

## File cần biết

| File | Vai trò |
|---|---|
| [src/data-source.ts](../../apps/api/src/data-source.ts) | Mảng entity tường minh — nguồn của `synchronize` |
| [src/main.ts](../../apps/api/src/main.ts) | Bootstrap + chọn bundle FE theo host |
| `src/common/middleware/csrf-origin.middleware.ts` | Chặn request thiếu `Origin` |
| `src/common/guards/read-only-throttler.guard.ts` | Hạn mức riêng cho GET |
| `src/modules/suppliers/price-replay.ts` | Phát lại cả chuỗi giá của một NCC |

## Test

126 file test (vitest), trong đó **17 test tích hợp** (`*.integration.test.ts`) nối MySQL thật với
`synchronize: false`. CI dựng service MySQL riêng cho chúng.
