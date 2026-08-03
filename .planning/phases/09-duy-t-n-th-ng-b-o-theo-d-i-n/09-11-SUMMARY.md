---
phase: 09-duy-t-n-th-ng-b-o-theo-d-i-n
plan: 11
wave: 6
status: complete-with-gap
completed_at: 2026-08-03
requirements-completed: [REQ-O]
files_modified:
  - apps/shop/src/components/BannerNotice.tsx
  - apps/shop/src/components/OrderStepper.tsx
  - apps/shop/src/lib/order-update.ts
  - apps/shop/src/lib/order-update.test.ts
  - apps/shop/src/lib/use-api.ts
  - apps/shop/src/pages/OrderTrackPage.tsx
  - packages/schemas/src/public-orders.ts
  - apps/api/src/modules/public/cancel-order.ts
  - apps/api/src/modules/public/cancel-order.test.ts
  - apps/api/src/modules/public/public-orders.controller.ts
  - apps/api/src/modules/public/public-orders.service.ts
  - apps/api/src/modules/public/entities/online-order-request.entity.ts
verification: >
  245/245 test api (gồm 2 test race 2 connection MySQL thật) · 35/35 test shop · tsc 5 project sạch ·
  bundle khách 360 kB raw / 104 kB gzip, gate 11 chuỗi cấm sạch · 5 kịch bản HTTP của DELETE chạy thật
  bằng curl · G-1 kiểm lại = 0 · CÒN 5 kịch bản trình duyệt chưa chạy (xem § cuối)
---

# 09-11 — `/o/:token` đầy đủ REQ-O + khách tự huỷ đơn

## Đã làm

Plan này gồm 3 task. **Task 1 đã xong ở phiên trước** (commit `064860b`); phiên này làm Task 2 và 3.

### Task 1 — 3 mảnh ghép (đã có từ trước, `064860b`)

`BannerNotice` thêm tone `'info'` (nối dây `InfoGlyph` vốn đã nằm sẵn trong file mà chưa tone nào
dùng) · `OrderStepper.tsx` 5 mốc ngang SVG tự vẽ, pulse tôn trọng `prefers-reduced-motion` ·
`detectOrderUpdate()` + 13 test.

### Task 2 — `OrderTrackPage` (commit `88ac72e`)

| Khối | Nội dung |
|---|---|
Poll | `setInterval` 8s gọi `reload()`, **dừng hẳn** khi `REJECTED` / `CANCELLED_BY_CUSTOMER` / `stage === 'COMPLETED'`, dọn interval khi unmount (T-09-62) |
Banner cập nhật | `tone="info"`, hiện khi `detectOrderUpdate()` báo true **hoặc** `cancelled_count > 0`; có món huỷ thì body là `cancelled_note` **nguyên văn từ API** (M2.D-21). Tự ẩn sau 30s |
Nhánh REJECTED | **Thay hẳn** khối %+stepper bằng banner đỏ, **ẩn số %**, không vẽ node dở dang. `CANCELLED_BY_CUSTOMER` dùng cùng khối nhưng title lấy `stage_label` ("Đơn đã huỷ") — nói "quán đã từ chối" với đơn do chính khách huỷ là sai sự thật |
Khối tiến độ | `{percent}%` (`--fs-3xl`/`--fw-heavy`/`--ok-600`) + stepper + `stage_label` 1 dòng + ETA khi có; bọc `aria-live="polite"` |
Tiêu đề trang | `WAITING` giữ "Đã gửi đơn thành công!", từ `CONFIRMED` trở đi đổi sang `stage_label` để không mâu thuẫn với stepper |
Muốn sửa đơn? | Chỉ hiện khi `CONFIRMED`: nút text mở ra "Đơn đã vào bếp, vui lòng gọi quán để đổi." đặt **ngay trên** nút gọi 1 chạm. **Không có ô sửa nào** (M2.D-45/46) |

Mọi giá trị hiển thị (`percent`, `stage`, `stage_label`, `cancelled_note`) render **nguyên văn từ
API** — FE không tính lại gì (T-09-60).

### Task 3 — khách tự huỷ đơn còn WAITING (commit `83efcc2`)

**`packages/schemas`** — `PublicOrderCancelResult` (`order_token` + `status` literal). Thêm vào file
số nhiều `public-orders.ts` đã được barrel export, KHÔNG tạo file số ít gần trùng tên.

**`cancel-order.ts`** — tách 2 tầng theo khuôn `submit-order.ts`:
- `decideCancel(status, storePhone)` — hàm **thuần**, 4 nhánh: `WAITING` → huỷ · `CANCELLED_BY_CUSTOMER`
  → idempotent · `REJECTED` → 409 `ORDER_ALREADY_REJECTED` · `CONFIRMED` **và mọi giá trị lạ** → 409
  `ORDER_ALREADY_CONFIRMED`. Nhánh mặc định là nhánh AN TOÀN: gặp status không nhận ra mà vẫn huỷ là
  xoá một đơn có thể đã vào bếp.
- `cancelOrderByCustomer(deps, token, nowMs)` — orchestrator qua port `CancelDeps`, test được bằng
  fake-deps không cần MySQL.

**Race khách-huỷ vs admin-xác nhận** giải bằng **đúng một cơ chế**: `cancelByToken()` chạy
`SELECT id, status FROM online_order_requests WHERE order_token = ? FOR UPDATE` — CÙNG hàng mà
`AdminOnlineOrdersService.lockWaitingRequest()` (09-06) khoá theo `id`. InnoDB tự xếp hàng; bên thứ
hai đọc được `status` đã đổi nên tự rơi vào nhánh 409. Không thêm cờ ứng dụng, không `GET_LOCK()`,
không so mốc thời gian.

**FE** — nút "Huỷ đơn" (chữ, không phải nút đặc) chỉ render khi `WAITING`, bấm mở hộp xác nhận 2 nút
inline; sau `CONFIRMED` nút **biến mất hoàn toàn**, không phải disable. Huỷ xong hiện "Đơn đã huỷ" +
nút "Xem menu", poll tự dừng. `deleteJson()` thêm vào `use-api.ts` dùng chung đường xử lý lỗi với
`postJson` (quan trọng nhất là `credentials: 'same-origin'` để trình duyệt gửi `Origin`).

## Verify đã chạy

| Kiểm | Kết quả |
|---|---|
`apps/api` vitest | **245/245 xanh** (19 file) |
`apps/shop` vitest | **35/35 xanh** (criteria đòi ≥30) |
`pnpm -r typecheck` | 5 project **sạch** |
`vite build` + `check-shop-bundle.sh` | raw **360 kB** · gzip **104 kB** · gate 11 chuỗi cấm **sạch** |
`git diff apps/shop/package.json` | **trống** — không thêm dependency nào |
`git diff scripts/check-shop-bundle.sh` | **trống** — không nới gate |
hex trong `OrderTrackPage.tsx` | **0** |

**Bundle theo từng bước** (ngưỡng kích thước đã bỏ hẳn từ OD-12, script chỉ in số):
352 kB (trước plan) → **356 kB** sau Task 2 → **360 kB** sau Task 3. Cả REQ-O mặt khách + nút huỷ
tốn 8 kB raw / ~1 kB gzip.

**5 kịch bản HTTP của `DELETE /api/public/orders/:token` — chạy thật bằng `curl`, API bật ở
`localhost:3001`:**

| # | Kịch bản | Kết quả |
|---|---|---|
1 | đơn `WAITING` → DELETE | **200** `{"order_token":"…","status":"CANCELLED_BY_CUSTOMER"}` |
2 | gọi lại lần 2 | **200**, cùng payload (idempotent), DB không đổi thêm |
3 | đơn đã `CONFIRMED` | **409** `ORDER_ALREADY_CONFIRMED`, DB **không** đổi |
4 | token không tồn tại | **404** `ORDER_NOT_FOUND`, message y hệt mọi trường hợp — không dùng làm oracle được (T-09-81) |
5 | bỏ header `Origin` | **403** `CSRF_ORIGIN_MISMATCH` — cùng `CsrfOriginGuard` với `POST` |

**G-1 kiểm lại sau khi FE đổi:** `curl … | grep -c '"state"'` = **0**.
**GET đơn khách đã huỷ:** `status=CANCELLED_BY_CUSTOMER · stage=REJECTED · stage_label="Đơn đã huỷ"
· percent=0 · eta_min=null` — đúng khối FE đang chờ.

**Race trên MySQL thật, 2 connection, cả hai chiều** (`cancel-order.test.ts`):
- admin vào trước → giao dịch huỷ **bị chặn 500ms** (chứng minh bằng `Promise.race`), sau khi admin
  commit thì đọc ra `CONFIRMED` → `decideCancel` cho 409. `SELECT status` cuối cùng: **một** giá trị.
- khách vào trước → admin **bị chặn**, sau commit đọc ra `CANCELLED_BY_CUSTOMER` (nhánh 409 của
  `lockWaitingRequest()` đã có sẵn từ 09-06). `cancelled_at` **không NULL**.

## Deviations from Plan

### 1. [Rule 1 — Bug chặn đường] `status` là `varchar(16)`, `CANCELLED_BY_CUSTOMER` dài 21 ký tự

Phát hiện ở Task 3 khi test race chạy lần đầu: MySQL trả `Data too long for column 'status'`.

Cột ra đời ở phase 8 với `length: 16` — vừa đủ cho `WAITING`/`CONFIRMED`/`REJECTED`, nên không ai
phát hiện. Giá trị thứ tư **chưa bao giờ có đường nào tạo ra** (chính plan này ghi vậy), nên khiếm
khuyết nằm im suốt 2 phase. Nói cách khác: `CANCELLED_BY_CUSTOMER` có trong type TS, có trong
`computeProgress()`, có nhãn riêng — nhưng DB không lưu nổi nó.

**Sửa:** entity đổi sang `length: 32` + docblock cảnh báo, và `ALTER TABLE … MODIFY COLUMN status
varchar(32) NOT NULL` chạy trên MySQL local. Nới rộng cột là thao tác an toàn dưới `synchronize:
true` (C-SCHEMA-07 chỉ cấm **rename**). Verify: test race chuyển từ đỏ sang xanh.

⚠ **Việc phải làm khi deploy:** `synchronize: true` sẽ tự nới cột lúc app boot trên VPS, nhưng đây là
`ALTER TABLE` trên bảng có dữ liệu — nên biết trước là nó sẽ chạy.

### 2. [Rule 2 — Thiếu thứ thiết yếu] Huỷ đơn không huỷ hàng thông báo đang chờ

Plan không nhắc. Nhưng `submit()` xếp hàng L1/L2/L3 vào `notification_outbox` (REQ-N), và cả
`confirm()` lẫn `reject()` của 09-06 đều gọi `cancelPendingForRequest()`. Thiếu bước đó ở nhánh
khách-huỷ thì SMS leo thang vẫn bắn cho quán về một đơn khách đã huỷ — đúng loại "báo nhầm" mà REQ-N
sinh ra để chống.

**Sửa:** `cancelPendingNotifications` là một `dep` bắt buộc của `cancelOrderByCustomer`, gọi trong
CÙNG transaction. Có test khẳng định (`calls.notificationsCancelled` = `['r1']`).

### 3. [Rule 2 — Thiếu thứ thiết yếu] Hàng chờ admin không tự bớt đơn khách vừa huỷ

Không emit SSE thì nhân viên còn thấy đơn ma trong hàng chờ và bấm Xác nhận → nhận 409.

**Sửa:** emit `online_order.reviewed` **sau commit** và **chỉ khi `changed === true`** (đó là lý do
`CancelOutcome` có field `changed`) — emit trong transaction rồi rollback là báo thay đổi không có
thật, cùng lý do T-09-51; emit cả ở lần gọi idempotent là bắt mọi tab admin tải lại vô cớ.

### 4. [Rule 1 — Bug] Poll làm nháy skeleton và xoá trang khi một lần poll rớt mạng

`useApi` bật `loading` và set `data = null` ở **mọi** lần gọi lại. Trang cũ render thẳng từ `data`
nên khi thêm poll 8s: (a) toàn trang nháy sang skeleton mỗi 8 giây, (b) một lần poll lỗi mạng — rất
thường trên 3G — **xoá sạch đơn trên màn hình** rồi hiện banner lỗi.

**Sửa tại trang, không đụng `useApi`** (nó dùng chung với menu/checkout): giữ state `shown` = bản đọc
tốt gần nhất, render từ nó; skeleton chỉ hiện khi `loading && !shown`, banner lỗi chỉ hiện khi
`error && !shown`. Poll hỏng trở thành "không có gì mới", không phải "mất đơn".

### 5. [Rule 1 — Bug] Hai file test xoá hàng sentinel của nhau

`cancel-order.test.ts` ban đầu dùng SĐT sentinel `0900000004`, khớp `LIKE '09000000%'` mà
`open-order-lock.integration.test.ts` dọn ở `beforeEach`. Vitest chạy song song → 2 test race đỏ khi
chạy **cả bộ**, xanh khi chạy **riêng file** — loại lỗi khó lần nhất.

**Sửa:** đổi tiền tố sang `09110000%` + comment cảnh báo. Verify: full suite 245/245.

### 6. [Rule 1 — Bug] Câu 409 vỡ khi quán chưa cấu hình SĐT

`curl` cho ra `"… — gọi  nếu bạn cần đổi."` (2 khoảng trắng) vì `store_phone` trống trên DB dev.
Response vẫn 409 đúng nên **không test nào bắt được**.

**Sửa:** `decideCancel` có nhánh riêng khi `storePhone.trim() === ''` → "vui lòng gọi quán nếu bạn
cần đổi." + 1 test.

**Total deviations:** 6 auto-fixed (2 bug chặn đường, 2 thiếu-thứ-thiết-yếu, 2 bug chất lượng).
**Impact:** không đổi kiến trúc, không đổi phạm vi. Deviation 1 là khiếm khuyết schema có từ phase 8;
2 và 3 đóng 2 lỗ hổng vận hành mà plan không thấy trước; 4-6 là lỗi do chính plan này tạo ra và đã sửa.

## ⚠️ 5 kịch bản trên trình duyệt CHƯA CHẠY

Acceptance criteria của Task 2 đòi mở `/o/<token>` ở viewport 375px và xem:
(a) đơn `WAITING` → 0%, node 1 sáng · (b) duyệt đơn ở màn admin → trong ≤10s trang khách tự đổi ·
(c) huỷ 1 món ở bàn → banner info + danh sách món và tổng tiền đổi theo · (d) từ chối đơn → banner đỏ,
không stepper, không % · (e) stepper không tràn ngang ở 375px.
Task 3 đòi thêm: bấm Huỷ đơn → hộp xác nhận → DB thành `CANCELLED_BY_CUSTOMER`; mở lại đơn đã
`CONFIRMED` → nút Huỷ đơn không còn.

**Chưa chạy.** Phiên này không có công cụ điều khiển trình duyệt; các kịch bản cần click thật + quan
sát render. **Không bịa kết quả.** Đây là cùng loại nợ với 09-10 — nay đã **2 plan liên tiếp** để lại
nghiệm thu trình duyệt, nên nó cần được gom lại làm một buổi kiểm bằng mắt trước khi đóng phase.

Đã chứng minh gián tiếp tới đâu:

| Kịch bản | Bằng chứng đã có | Còn phải kiểm bằng mắt |
|---|---|---|
(a)(b) % + mốc | BE trả đúng `percent`/`stage`/`stage_label` (09-09, 34 test); poll 8s + `reload()` là code thẳng | Node sáng đúng chỗ, số % đọc được ở 375px |
(c) món huỷ | `detectOrderUpdate` 13 test; `cancelled_note` đi thẳng từ API | Banner hiện đúng lúc, đọc lọt câu |
(d) từ chối | `GET` đơn đã huỷ trả `stage=REJECTED` + `stage_label` — đã curl thật | Banner đỏ thay hẳn stepper trên màn |
(e) stepper 375px | `flex: 1 1 0` + `minWidth: 0`, không media query | Có tràn ngang không |
Huỷ đơn | 5 kịch bản HTTP curl **đã chạy thật** + 2 test race MySQL | Hộp xác nhận 2 nút, nút biến mất sau CONFIRMED |

Cách kiểm nhanh (~10 phút): `pnpm --filter @order/api dev` + `pnpm --filter @order/shop dev` +
`pnpm --filter @order/web dev` → đặt 1 đơn ở `localhost:5174` → mở `/o/<token>` ở DevTools 375px →
duyệt/từ chối/huỷ món ở `localhost:5173/admin/online-orders` và xem trang khách đổi theo.

## Nợ để lại

- **`PATCH /api/public/orders/:token` (nửa SỬA đơn của M2.D-44) chưa làm** — chủ dự án chốt
  2026-07-31 hoãn sang phase 10. Plan 09-13 ghi nợ việc này.
- **`cancelled_at` chỉ được ghi, chưa ai đọc.** Không endpoint nào trả nó ra. Cột tồn tại để sau này
  trả lời "khách huỷ lúc mấy giờ" — nếu phase sau không dùng thì đây là cột chết, cân nhắc bỏ.
- **Huỷ đơn không ghi audit log.** `<threat_model>` T-09-80 nói "mọi lần huỷ ghi audit log kèm
  `ip_hash` để truy được", nhưng `AuditInterceptor` chỉ phủ `/admin/*`. Hiện chỉ truy được qua
  `online_order_requests.status` + `cancelled_at`, **không có `ip_hash` của người bấm huỷ**. Đây là
  lệch so với mitigation đã ghi trong threat model — cần quyết định ở phase sau: hoặc mở
  `AuditInterceptor` cho nhánh này, hoặc sửa lại lời hứa trong threat model.
- Bundle `apps/shop` vẫn **1 chunk 360 kB** chưa tách route — OD-12 đã hoãn bàn tới sau milestone 2.

## Self-Check: PASSED

- `cancel-order.ts` + `cancel-order.test.ts` tồn tại trên đĩa ✓
- `git log --grep="09-11"` trả 3 commit (`064860b`, `88ac72e`, `83efcc2`) ✓
- Toàn bộ `<acceptance_criteria>` của Task 2 và Task 3 đã chạy lại, trừ 5 kịch bản trình duyệt đã
  khai báo tường minh ở trên ✓
- `<verification>` mục 1,2,3,5,6 xanh; mục 4 và 7 (chạy tay trên trình duyệt) là phần còn nợ ✓
