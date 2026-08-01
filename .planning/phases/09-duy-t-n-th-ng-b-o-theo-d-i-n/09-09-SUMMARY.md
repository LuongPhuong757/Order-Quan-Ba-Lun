---
phase: 09-duy-t-n-th-ng-b-o-theo-d-i-n
plan: 09
wave: 5
status: complete
completed_at: 2026-08-01
files_modified:
  - packages/schemas/src/public-orders.ts
  - apps/api/src/modules/public/public-orders.service.ts
  - apps/api/src/modules/public/public.module.ts
  - apps/api/src/modules/public/public-orders.test.ts
verification: 34/34 test trong public-orders.test.ts · full suite 224/224 · tsc api+web sạch · 7 kịch bản chạy thật
---

# 09-09 — `/o/:token` trả % + 5 mốc, và submit xếp hàng thông báo + bắn SSE

## Đã làm

**`packages/schemas/src/public-orders.ts`** — `PublicOrderStatus` thêm đúng 8 field theo whitelist
§6: `stage`, `stage_label`, `percent`, `cancelled_count`, `cancelled_note`, `eta_min`, `eta_max`,
`updated_at_ms`. Docblock ghi rõ `.strict()` là lưới an toàn cuối cùng của G-1 — đổi sang
`.passthrough()` là gỡ đúng cái chốt đó.

**`public-orders.service.ts` — `getByToken()` viết lại phần dựng payload:**
- Có `order_id` → đọc `Order` + `order_items` THẬT; bỏ dòng `is_note` (ghi chú cho bếp, không phải
  món khách đặt); `items` map tay đúng 3 field; `subtotal` = Σ của chính danh sách đó (M2.D-47).
- Chưa duyệt → dùng `items_snapshot` + `request.subtotal` như phase 8.
- `item_states` **chỉ để tính** `percent`, không bao giờ ra response (G-1).
- Đơn điệu: `UPDATE max_progress_shown` **chỉ khi % tăng** (T-09-49).
- `eta_min`/`eta_max` theo `fulfillment_type`, `null` khi stage `REJECTED`/`COMPLETED`.
- `stage_label`: khách tự huỷ dùng `STAGE_LABEL_CANCELLED_BY_CUSTOMER` — không nói "quán đã từ chối"
  với đơn do chính khách huỷ.
- Đổi tên field `orderRepo` → `requestRepo` (nó vốn là repo của `online_order_requests`), thêm
  `orderRepo`/`itemRepo` thật — tên cũ gây hiểu sai ở file có 2 loại "order".

**`submit()`** — `enqueueForNewRequest` gọi **bên trong** `ds.transaction` (outbox pattern: đơn và
lịch thông báo cùng commit hoặc cùng rollback), rồi emit `online_order.new` **sau** commit, bọc
try/catch nuốt lỗi. Không đổi chữ ký `submitOrder` (plan 09-12 còn sửa file đó).

**`public.module.ts`** — thêm `Order`/`OrderItem` vào `forFeature` + module thông báo vào `imports`.

**`public-orders.test.ts`** — giữ nguyên 19 test cũ, thêm **15 test** cho `getByToken` (dựng service
bằng constructor với repo giả, không Nest, không MySQL). Tổng **34/34 xanh**.

## 7 kịch bản chạy thật

| # | Kịch bản | Kết quả |
|---|---|---|
| 1 | **G-1** (M2.D-23) — `curl` đơn đã CONFIRMED | `grep '"state"'` = **0**; body có `percent:15`, `stage:"CONFIRMED"`, `stage_label:"Đã xác nhận"` |
| 2 | **D-09** — từ chối kèm ghi chú `ZZTEST ...` | Ghi chú **có** trong `internal_reject_note` của DB, response công khai `grep ZZTEST` = **0**, `grep 'bom hang'` = **0**; `reject_reason` = "Hết nguyên liệu món đã đặt" |
| 3 | **Đơn điệu** (M2.D-19) | 15 → (món sang READY) **100** → (bếp trả về KITCHEN) vẫn **100**. `max_progress_shown` trong DB = 100 ở cả 2 lần sau |
| 4 | **Lịch outbox** | `L1/SSE delay_s=0` · `L2/SMS delay_s=90` · `L3/EMAIL delay_s=0` — đúng `escalate_sms_after_s` |
| 5 | **Không có L4** (D-12) | `SELECT COUNT(*) ... level='L4'` = **0** |
| 6 | **SSE `new` < 2s** (criterion 1) | **403 ms** từ lúc gửi `POST /api/public/orders` tới lúc dòng `data:` có `"type":"new"` xuất hiện trên stream |
| 7 | **SMS bắn / duyệt kịp thì huỷ** (criterion 4) | Đơn KHÔNG duyệt → `L2/SMS = SENT` + log `[SMS:console] → 0900000000`. Đơn duyệt ngay → `L2/SMS = CANCELLED`, không có log SMS |

Kịch bản 7 chạy với `escalate_sms_after_s` **tạm hạ xuống 5s** để không phải chờ 110s. **Đã trả
settings về nguyên trạng** sau khi kiểm (xem mục dưới).

Kịch bản 7 cũng **đóng nốt assert còn nợ của plan 09-08** (outbox L2 → `CANCELLED` khi duyệt kịp).

## Việc phát hiện được — 3 thứ, không nằm trong phạm vi plan này

### 1. `store_settings` trong DB dev RỖNG HOÀN TOÀN (0 dòng)

Mọi setting đang chạy bằng default trong `settings.defaults.ts`. Hệ quả trực tiếp: mặc định
`notify_sms_recipients` = `[]` và `notify_email_recipients` = `[]` nên **submit chỉ sinh 1 hàng
L1/SSE**, không có L2/SMS lẫn L3/EMAIL. Đó là hành vi ĐÚNG theo `outbox-rules.ts` ("rỗng → không
tạo rác"), nhưng nghĩa là **cảnh báo SMS hiện không tới ai** trên môi trường này — lớp bảo vệ duy
nhất còn lại tới được người không ngồi trước máy (sau khi D-12 bỏ auto-OFF) đang tắt trong thực tế.

Không có UI nào để đặt 2 setting này: `UpdateSettingsDto` của `PUT /admin/settings` không khai
`notify_sms_recipients`/`notify_email_recipients`. **Phải thêm ô nhập, nếu không thì trước khi
go-live phải INSERT tay.** Đề nghị đưa vào 09-12 (plan đó vốn đã sửa `AdminSettingsPage` +
`settings.controller`) hoặc ghi thành hạng mục UAT bắt buộc.

### 2. 🐛 `created_at` ghi giờ LOCAL còn các cột datetime khác ghi UTC — lệch 7 giờ

Đo trực tiếp trên 1 hàng outbox thật:

```
level | created_at                  | scheduled_at                | sent_at
L2    | 2026-08-01 00:21:41.900037  | 2026-07-31 17:21:46.884000  | 2026-07-31 17:22:00.007000
TIMESTAMPDIFF(SECOND, created_at, sent_at) = -25181   (âm ~7 giờ)
```

`scheduled_at`/`sent_at` do JS ghi (mysql2 `timezone:'Z'` chuyển sang UTC) → UTC. `created_at` là
`@CreateDateColumn` → TypeORM để MySQL tự sinh bằng `CURRENT_TIMESTAMP(6)`, mà `@@session.time_zone`
= `SYSTEM` (+07) → giờ local.

**Comment trong `data-source.ts` dòng 26-31 nói sai:** nó khẳng định `timezone:'Z'` khiến mysql2
"gửi `SET time_zone='+00:00'` cho mỗi connection mới". Thực tế mysql2 chỉ dùng option đó để
serialize/parse `Date` phía driver, **không** phát lệnh `SET time_zone`. Ai tin comment đó sẽ tính
sai mọi khoảng thời gian dựa trên `@CreateDateColumn`.

**Hậu quả nhìn thấy được:** SMS leo thang luôn in **"chờ duyệt quá 0s"** thay vì số giây thật, vì
`outbox-poller.ts:64` tính `Math.max(0, Math.round((nowMs - row.created_at) / 1000))` → giá trị âm →
kẹp về 0. Nội dung SMS vẫn hành động được (nói đúng số đơn đang chờ) nên **không phải blocker**,
nhưng nó là dấu hiệu của lệch giờ có thể cắn ở chỗ khác. **Chưa sửa** — `outbox-poller.ts` và
`data-source.ts` đều ngoài `files_modified` của plan này. Đề nghị 1 plan hạ tầng riêng, sửa cùng lúc
với vấn đề dotenv ở 09-07-SUMMARY mục 2.

### 3. `store_phone` đang rỗng

Response `/o/:token` trả `store_phone: ""`. M2.D-45/46 (sau CONFIRMED khách chỉ còn cách gọi điện)
phụ thuộc số này. Plan 09-11 dựng nút gọi sẽ hiện nút trỏ tới số rỗng. Cần chủ quán điền ở
`/admin/settings` — ô này **đã có** trong `UpdateSettingsDto`, chỉ là chưa ai điền.

## 2 acceptance criteria đếm-chuỗi bị lệch

`online_order.new` và `NotificationsModule` ban đầu đếm ra 2 và 3 vì chuỗi lặp trong comment/docblock
— đã diễn đạt lại, nay đúng 1 và 2.

Còn **`computeProgress` = 2** (plan ghi = 1): dòng `import` + dòng gọi. Không thể xuống 1 nếu vẫn
import bằng named import. Cùng loại lệch với `takeUntil` ở 09-07 — đề nghị sửa số trong verifier.

## Nợ để lại

- Dữ liệu test cộng dồn: các đơn `Khach 0909 A–D` (A đã REJECTED kèm ghi chú `ZZTEST`, D đã
  CONFIRMED và món đang ở KITCHEN sau khi test đơn điệu). Đơn `Khach 0909 B` còn `WAITING` với 1
  hàng `L2/SMS` đã `SENT` (ngưỡng 90s trôi qua trong lúc chạy các kịch bản khác).
- `settings` đã trả về nguyên trạng: `store_settings` lại **0 dòng**, `escalate_sms_after_s` đọc qua
  API = **90** như trước khi thử.
