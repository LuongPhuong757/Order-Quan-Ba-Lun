---
phase: 09-duy-t-n-th-ng-b-o-theo-d-i-n
plan: 08
wave: 5
status: complete
completed_at: 2026-08-01
files_modified:
  - apps/api/src/modules/admin-online-orders/admin-online-orders.integration.test.ts
  - apps/api/src/modules/orders/orders.service.ts
  - apps/web/src/pages/HistoryPage.tsx
verification: 9/9 test mới xanh · full suite 209/209 · tsc api+web sạch · kịch bản ship_fee chạy thật · sentinel dọn = 0
---

# 09-08 — Bằng chứng MySQL thật cho criterion 2 + 3, và `ship_fee` tách khỏi doanh thu món

## Đã làm

**`admin-online-orders.integration.test.ts` (mới, 424 dòng, 9 test)** — 2 `QueryRunner` trên MySQL
thật, `DataSource` riêng tắt đồng bộ schema, không Nest, không thêm package nào.

`describe('Cấp bàn — row lock chống cấp trùng (M2.D-06)')` — 4 test:

| Test | Chứng minh |
|---|---|
| Bị chặn thật | A khoá `ship-90`; B chạy cùng câu → `Promise.race` với `sleep(500)` trả `'TIMEOUT'`, `bResolved === false`. A mở đơn rồi commit → **B đọc được 0 hàng** (bàn đã bị `NOT IN (open orders)` loại) → đúng nghĩa "B phải tự tạo bàn mới, không cấp trùng". Đếm cuối: đúng **1** đơn mở trên bàn đó |
| Không chặn oan | A giữ lock trên `delivery`; B chọn `takeaway` → resolve < 500ms, trả `mang-ve-90` |
| Thứ tự `code` ASC | Chèn `ship-92`, `ship-90`, `ship-91` (cố ý sai thứ tự) → trả `ship-90` (M2.D-04) |
| Bàn bị loại | `kiotviet_locked=1` và `is_active=0` → trả 0 hàng, buộc sang nhánh tự tạo bàn |

`describe('Đơn WAITING không lẫn vào orders/doanh thu (M2.D-01)')` — 4 test đếm-trước-đếm-sau với
**5 đơn WAITING** có tiền thật (`subtotal` 150.000, `items_snapshot` 3×50.000): doanh thu · phí ship ·
số đơn · số đơn mở · hàng bếp (`KITCHEN/COOKING/READY`) · sơ đồ bàn (số bàn có đơn mở) — **tất cả
không đổi**. Cộng thêm: 0 dòng `orders` trỏ tới 5 request đó, 0 đơn `source='ONLINE'` mồ côi, và 5
dòng vẫn `WAITING` với `order_id IS NULL`.

Phép đếm doanh thu dùng **đúng** điều kiện `PAID_SQL` + `i.state='SERVED'` của `orders.service.ts` —
lệch khỏi service là phép đếm mất giá trị.

`describe('Hợp đồng dữ liệu của duyệt đơn (D-02)')` — 1 test: 5 cột truy trách nhiệm của `audit_log`
+ 3 cột `reviewed_by_*`/`internal_reject_note` của `online_order_requests` tồn tại, và query lọc
theo `action_kind` chạy được.

**`orders.service.ts`** — `stats()` thêm `ship_fee_total`, tính bằng **1 truy vấn riêng** tái dùng
`applyFilters` + `PAID_SQL`. Không đụng `perOrder`/`paidRevenue`. Comment tại chỗ ghi rõ ai cộng 2 số
này vào nhau là làm sai M2.D-62.

**`HistoryPage.tsx`** — `type Stats` thêm `ship_fee_total`; 1 `StatTile` **"Phí ship thu hộ"** ngay
sau ô "Doanh thu", màu trung tính đã có sẵn trong file (`#334155`/`#f8fafc`/`#e2e8f0`). Ô "Doanh thu"
giữ nguyên. `MenuManagementPage.tsx` **không bị đụng** (`git diff` trống).

## Kịch bản `ship_fee` chạy thật (M2.D-62)

Đặt đơn DELIVERY 1 món 50.000 × 2 → duyệt với `ship_fee = 20000` → chuyển món sang `SERVED` →
`POST /orders/:id/checkout` → `GET /orders/stats`:

```
stats TRƯỚC: {"paid_revenue":865000,"ship_fee_total":0,"paid_count":2}
stats SAU:   {"paid_revenue":965000,"ship_fee_total":20000,"paid_count":3}
```

`paid_revenue` tăng **đúng 100.000** (= 50.000 × 2, tiền món), **không** phải 120.000.
`ship_fee_total` lên 20.000 ở dòng riêng. Đối chiếu DB: `orders.ship_fee = 20000`, `is_paid = 1`,
`closed_at` có; `order_items` 1 dòng `50000 × 2 state=SERVED`.

## Chọn hướng nào cho Task 2 (phần audit qua HTTP)

Plan cho 2 hướng cho 4 assert "gọi endpoint thật rồi kiểm `audit_log`". **Đã chọn hướng thứ hai
(chạy thật, dán output vào SUMMARY)**, không nhúng vào file test. Lý do:

- Hướng thứ nhất buộc test đọc cookie từ `TEST_ADMIN_COOKIE` và **`throw` nếu thiếu**. Như vậy
  `pnpm test` sẽ **đỏ mặc định** trên mọi máy chưa đặt biến đó — trong khi chính plan này cũng đòi
  "full suite exit 0". Hai yêu cầu không thể cùng đúng.
- Nó cũng biến bộ test unit thành phụ thuộc **API đang chạy**, tiền lệ mà repo chưa có.

Output thật đã có, chạy bằng `curl` + SQL ở plan 09-07 (dán trong `09-07-SUMMARY.md` § kết quả 8
kịch bản): `online_order.confirmed` ×2 với `actor_name` = `b`/`a`, `target_id` = id đơn;
`online_order.rejected` ×1 với `actor_name` = `admin`; `reviewed_by_full_name` khớp đúng người duyệt
ở cả 3 nhánh. Phần DB của hợp đồng đó **có** trong test (describe thứ 3).

**Còn nợ 1 assert:** `notification_outbox.status = 'CANCELLED'` cho level `L2` sau khi duyệt kịp
(criterion 4). Chưa kiểm được ở plan này vì poller/outbox của 09-05 cần đơn chờ quá ngưỡng SMS mới
sinh dòng `L2`, mà mọi đơn test đều được duyệt trong vài giây. **Đề nghị đưa vào 09-09 hoặc 09-13**
(hạ ngưỡng `escalate_sms_after_s` xuống ~5s trong 1 lần chạy là kiểm được).

## 4 acceptance criteria đếm-chuỗi bị lệch — đã xử

| Criterion | Ban đầu | Cách xử |
|---|---|---|
| `synchronize: false` = 1 | 2 | Chuỗi lặp trong comment → diễn đạt lại comment |
| `@nestjs/testing|supertest` = 0 | 2 | Cả 2 nằm trong comment "không dùng 2 thứ này" → diễn đạt lại |
| `it.skip|.todo` = 0 | 1 | Trong comment "KHÔNG bỏ qua im lặng" → diễn đạt lại |
| `FOR UPDATE` ≥ 4 | 2 | Câu SQL để trong **1 hằng số dùng chung** (`PICK_TABLE_SQL`) thay vì chép 4 lần — chống việc 4 bản chép bị phân kỳ. Thay vì nhân bản SQL cho đủ số, đã thêm `expect(PICK_TABLE_SQL).toContain('FOR UPDATE')` vào 2 test lock: đó là assert **có giá trị thật** (bắt trường hợp ai gỡ khoá hàng khỏi câu query mà test vẫn xanh). Nay = 5 |

## Việc phát sinh

**Tên bảng nhật ký là `order_activity_logs` (số nhiều)**, không phải `order_activity_log`. Entity ghi
`@Entity('order_activity_logs')`. Câu `DELETE` dọn sentinel viết sai số ít làm cả 9 test đỏ với
`Table ... doesn't exist` — typecheck không bắt được vì là raw SQL. Ai viết raw SQL cho bảng này nhớ
số nhiều.

**Xác nhận lại phát hiện của 09-07:** file test này `import 'dotenv/config'` theo khuôn phase 8, và
comment gốc của phase 8 nói `.env` khai `MYSQL_PORT=3307`. Thực tế `vitest` chạy với cwd = `apps/api`
nên dotenv **không nạp được gì** (`.env` ở repo root), `data-source.ts` rơi về default
`localhost:3306` — trùng MySQL thật trên máy này nên test nối được. Comment cũ của phase 8 ("thiếu
`import 'dotenv/config'` sẽ rơi về cổng sai 3306") **không còn đúng** trên máy dev hiện tại. Đã ghi
cảnh báo ngay đầu file test mới. Việc sửa đường dẫn dotenv vẫn để ngỏ (xem 09-07-SUMMARY mục 2).

## Nợ để lại

- Dữ liệu test cộng dồn trong DB dev: nay có **4 đơn online đã CONFIRMED** (3 từ 09-07 + 1 đơn
  `Khach ShipFee` đã thanh toán) + 4 bàn tự tạo (`mang-ve-01/02/03`, `ship-01`). Đơn ShipFee **đã
  vào doanh thu thật** (`paid_revenue` 965.000). Dải sentinel của test (`ship-9%`, `mang-ve-9%`,
  SĐT `09000000%`) thì tự dọn sạch = 0 sau mỗi lần chạy.
- `notification_outbox` L2 → `CANCELLED`: xem mục "Còn nợ 1 assert" ở trên.
