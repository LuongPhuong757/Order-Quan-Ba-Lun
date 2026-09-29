<!-- Sinh: 2026-09-29 | 37 bảng, 37 entity | MySQL 8 InnoDB utf8mb4 -->

# Dữ liệu — MySQL 8

## KHÔNG CÓ MIGRATION

Schema dựng bằng TypeORM `synchronize` từ **mảng entity tường minh** trong
[apps/api/src/data-source.ts](../../apps/api/src/data-source.ts). `migration:run` có trong
`package.json` nhưng thư mục migration **rỗng** — đừng dựa vào nó.

Ba hệ quả phải nhớ:

1. Entity mới **không khai** trong `data-source.ts` → `tsc` xanh, `TypeOrmModule.forFeature` khởi
   động bình thường, nhưng bảng **không được tạo** và runtime gãy.
2. DB dev **dùng chung giữa mọi worktree**. Sync từ nhánh thiếu entity = **DROP cột** của nhánh
   khác. Luôn sync từ nhánh tổng hợp nhất.
3. Đối chiếu bằng `pnpm --filter @order/api schema:verify`.

Quan hệ chủ yếu là **cột khoá ngoại trần**, không dùng decorator `@ManyToOne`/`@OneToMany`
(cả repo chỉ có 1 cặp, giữa `orders` ↔ `order_items`). Đừng tìm relation — tìm cột id.

## 37 bảng theo miền

### Bán hàng
```
orders                      đơn (tại bàn / mang về / giao)
order_items                 dòng món          ── ManyToOne → orders
order_activity_logs         nhật ký thao tác trên đơn
order_payment_photos        ảnh bill chuyển khoản
restaurant_tables           bàn (có khoá bàn)
```

### Thực đơn & kho
```
menu_groups                 nhóm món
menu_items                  món
ingredients                 nguyên liệu   ⚠ lưu theo g/ml (xem "Đơn vị" bên dưới)
recipe_lines                công thức: món ↔ nguyên liệu
order_item_ingredient_usage trừ kho thực tế theo từng dòng món
```

### Nhà cung cấp
```
suppliers                   NCC
supplier_items              mặt hàng của NCC
supplier_deliveries         phiếu nhập
supplier_delivery_lines     dòng phiếu nhập
supplier_delivery_photos    ảnh phiếu
supplier_payments           thanh toán cho NCC
supplier_users              tài khoản cổng NCC
supplier_sessions           phiên cổng NCC (danh tính RIÊNG, không phải users)
```

### Đặt online & khách
```
online_order_requests       đơn khách gửi, chờ duyệt
customer_otps               OTP điện thoại
customer_sessions           phiên khách (danh tính RIÊNG thứ ba)
phone_blacklist             chặn số quấy rối
web_visit_sessions          phiên truy cập web
web_page_views_daily        lượt xem theo ngày
web_cart_snapshots          ảnh chụp giỏ bỏ dở
geo_share_daily             thống kê chia sẻ vị trí
geo_share_failures          ca chia sẻ vị trí thất bại (chẩn đoán iPhone)
```

### Thanh toán
```
payment_intents             yêu cầu thanh toán + mã
payment_qr_accounts         tài khoản nhận QR
bank_transactions           giao dịch ngân hàng về qua webhook SePay
```

### In ấn
```
print_devices               máy in đã ghép
print_jobs                  hàng đợi việc in (cầu in kéo về)
```

### Hệ thống
```
users                       nhân viên / chủ quán
revoked_jwt_jti             JTI đã thu hồi (đăng xuất)
recovery_codes              mã khôi phục
audit_log                   nhật ký audit
store_settings              cấu hình quán
notification_outbox         hàng đợi thông báo (OutboxPoller nhịp 15s)
```

## Đơn vị — bẫy 1000×

DB lưu **`g` và `ml`**. Màn nhập hàng hiển thị **KG / L**, server tự nhân hệ số. Phiếu tạo
**trước 2026-09-07** còn sai 1000×.

Đơn vị tính là **tuỳ ý** (bỏ whitelist 2026-09-07): từ lạ trở thành đơn vị đếm, tự nó là gốc.
Ô nhập phải cho **gõ tự do**.

Sửa phiếu nhập → chạy
[price-replay.ts](../../apps/api/src/modules/suppliers/price-replay.ts) phát lại **cả chuỗi giá**
của NCC đó, đừng tính lẻ một phiếu.

## Công nợ

Công nợ NCC cộng **hết mọi phiếu**, không lọc theo `opening_balance_date` (sửa ở 4 chỗ) — nợ cũ
được coi là nợ **ngoài** hệ thống.

## Sao lưu

Production: `/opt/orderquanbalun/backups` trên VPS. Khôi phục lẻ một bảng qua DB tạm. Ảnh nằm ở
`uploads/` nên **mất `image_url` ≠ mất ảnh**.
