<!-- Hợp đồng API M7. Spec: MILESTONE-07-GOI-MON-TAI-BAN-SPEC.md · Kế hoạch: MILESTONE-07-KE-HOACH.md -->

# M7 — Hợp đồng API: Khách tự gọi món tại bàn

> Viết cho người hiện thực BE và FE. Mọi khuôn dưới đây đã đối chiếu với code đang chạy, không
> phải quy ước mới.

## 0. Quy ước chung

**Thành công** — `apiOk()` từ `@order/utils`:
```json
{ "ok": true, "data": { } }
```

**Lỗi** — `GlobalExceptionFilter` (`common/filters/global-exception.filter.ts`):
```json
{ "code": "TABLE_NOT_FOUND", "message": "Không thấy bàn số 5.", "field_errors": [] }
```

⚠ **Luật về `message`**: filter lấy `body.message || FRIENDLY_VN[code]`. Mọi mã lỗi của M7 **đều
phải tự đặt `message`** và **KHÔNG được thêm vào `FRIENDLY_VN`** — câu chữ của M7 có số liệu động
(số bàn, số phút còn lại, tên món) mà từ điển tĩnh không nội suy được.

**CSRF**: `CsrfOriginGuard` đã phủ sẵn `/api/public/*`. Mọi `POST`/`DELETE` **bắt buộc có header
`Origin` hợp lệ** — thiếu là 403, và triệu chứng trông y hệt lỗi code. `curl` thử tay nhớ kèm.

**Rate limit — HAI LỚP, không phải một.** ⚠ Soát bảo mật 2026-10-01 bắt được lỗ hổng ở phương án
một lớp: nếu chỉ đổi tracker sang `guest:<token>`, kẻ xấu mint token vô hạn qua `/table/open` thì
**mỗi token lại có nguyên một hạn mức 600/phút riêng** — tức là tháo bỏ hoàn toàn trần theo IP,
đổi rủi ro "quán dùng chung IP" lấy rủi ro nặng hơn "một IP có hạn mức vô tận".

| Lớp | Áp cho | Trần | Mục đích |
|---|---|---|---|
| Theo `guest:<token>` | `/table/cart`, `/table/state`, `/table/call` | 60/phút | Khách poll không đếm chung ô với máy nhân viên |
| Theo IP, **sàn không được miễn** | 3 endpoint trên | 2000/phút | Chặn một IP mint hàng trăm token rồi dùng đồng thời |
| Theo IP | `/table/open` | 10/phút | **Luôn tính theo IP bất kể có token hay chưa** — tuyệt đối không `shouldSkip` |

Không có token → tracker `guestip:<ip>`, **một ô RIÊNG**, không bao giờ rơi về `super.getTracker(req)`.

**Hash IP**: dùng `hashIp()` / `resolveIpHashSalt()` có sẵn ở `apps/api/src/modules/public/ip-hash.ts`.
Không tự hash SHA-256 trần không salt.

**Nhịp poll của màn khách: 5 giây.** Không nhanh hơn.

---

## 1. Công khai — cho `apps/shop` (không đăng nhập)

Tất cả nằm dưới `@Controller('api/public/table')`.

### 1.1 `POST /api/public/table/open` — vào bàn

Phân giải số bàn khách gõ và cấp phiên thiết bị.
⚠ **KHÔNG tạo dòng `orders` nào** (R1 — tạo đơn lười). Đơn chỉ sinh ra ở `/cart`.

**Request**
```json
{ "table_input": "5", "code": "7312" }
```
| Field | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `table_input` | string, 1–16 ký tự | ✓ | Chuỗi thô khách gõ: `"5"`, `"05"`, `"bàn 5"`, `" Bàn  5 "` |
| `code` | string, đúng 4 chữ số | — | Chỉ gửi khi lần trước server trả `NEED_CODE` |
| `guest_token` | string 64 hex | — | **FE LUÔN gửi kèm nếu `localStorage` còn** — xem §1.1-bis |

### 1.1-bis Máy cũ quay lại — KHÔNG hỏi mã

⚠ Phân biệt hai ca, vì cùng một thao tác "gõ lại số bàn" có hai ý nghĩa trái ngược:

| Ca | Điều kiện | Server trả |
|---|---|---|
| **Máy cũ quay lại** | `guest_token` gửi kèm còn sống **và** trỏ đúng đơn đang mở của chính bàn đó | `OPENED` + **kèm luôn `guest_code`** + `table_name`. Không hỏi mã, không cấp token mới |
| **Máy lạ** | Không gửi token, hoặc token hết hạn / trỏ bàn khác / trỏ đơn đã đóng | `NEED_CODE` |

**Vì sao phải có nhánh một**: khách đóng tab, hết pin, chuyển sang tab khác rồi quay lại là ca
thường xuyên nhất trong một bữa ăn. Bắt máy đã có quyền nhập lại mã là làm khó đúng người hợp lệ.

**Vì sao nhánh hai tuyệt đối không được nới**: nếu chỉ gõ số bàn mà ra mã thì mã bàn **mất sạch ý
nghĩa** — ai đi ngang cũng gõ "5" rồi đọc bill và gọi món vào bàn người khác. D-05 và toàn bộ lớp
chống rò ở §1.3 sụp theo.

**Ca còn lại — mất `localStorage`** (Safari riêng tư, xoá dữ liệu, đổi máy): từ góc nhìn server,
máy này **không phân biệt được với người lạ**, nên không có cách nào an toàn để tự nhận ra. Lối
thoát là con người: nhân viên đọc mã từ drawer bàn (§2.5) và đưa lại cho khách. Đây chính là lý do
`guest_code` phải hiện **thường trực** trên màn khách chứ không chỉ hiện một lần lúc sinh mã —
khách nhìn thấy mã suốt bữa thì gần như không rơi vào ca này.

**Response — bàn trống, vào được**
```json
{ "ok": true, "data": {
  "state": "OPENED",
  "guest_token": "a3f1…64 hex",
  "table_name": "Bàn 5 — Sân sau",
  "has_code": false
} }
```
⚠ **`guest_token` sinh Ở SERVER** bằng `randomBytes(32).toString('hex')` (CSPRNG) — cùng lệ
`order_token` (`submit-order.ts:294`) và `customer_sessions.token`. **Không** `Math.random`, **không**
uuid thường. Request không có field nào để client gửi token lên.

`has_code: false` ⇒ bàn chưa có phiên nào, khách này là người đầu tiên.
FE **phải hiện `table_name` cỡ lớn và bắt khách xác nhận** trước khi cho chọn món (R1 — đây là
chốt chặn duy nhất chống gọi nhầm bàn).

**Response — bàn đang có phiên, cần mã**
```json
{ "ok": true, "data": { "state": "NEED_CODE", "table_name": "Bàn 5 — Sân sau" } }
```
FE hiện: *"Bàn này đang dùng rồi, vui lòng nhập mã bàn để gọi thêm."* (D-05)

**Response — gửi kèm `code` đúng**
Giống `OPENED`, kèm `has_code: true`.

**Lỗi**

| HTTP | `code` | Khi nào | `message` mẫu |
|---|---|---|---|
| 404 | `TABLE_NOT_FOUND` | Không bàn nào khớp | `Không thấy bàn số 5. Bạn xem lại số dán trên bàn nhé.` |
| 409 | `TABLE_AMBIGUOUS` | Nhiều bàn cùng khớp | `Có 2 bàn mang số 5. Nhờ nhân viên giúp bạn nhé.` |
| 409 | `TABLE_NOT_DINEIN` | Bàn `kind` ≠ `dine-in` | `Chỗ này không phải bàn ăn tại quán.` |
| 409 | `TABLE_KIOTVIET_LOCKED` | `kiotviet_locked` | `Bàn này đang khoá. Nhờ nhân viên giúp bạn nhé.` |
| 403 | `TABLE_CODE_WRONG` | Mã sai | `Mã bàn không đúng. Bạn còn 3 lần thử.` |
| 423 | `TABLE_CODE_LOCKED` | 10 lần sai trên cùng bàn | `Nhập sai nhiều quá. Thử lại sau 15 phút hoặc nhờ nhân viên.` |
| 409 | `STORE_CLOSED` | Quán đóng cửa | `Quán đang đóng cửa.` |
| 409 | `TABLE_HAS_ONLINE_ORDER` | Đơn mở của bàn có `source='ONLINE'` | `Bàn này đang có đơn đặt trước. Nhờ nhân viên giúp bạn nhé.` |
| 409 | `TABLE_ORDERING_OFF` | Công tắc D-15 tắt | `Quán đang tạm tắt gọi món bằng điện thoại. Nhờ nhân viên giúp bạn nhé.` |
| 429 | `THROTTLED` | Vượt trần | `Bạn thao tác hơi nhanh. Đợi một chút nhé.` |

⚠ `TABLE_KIOTVIET_LOCKED` là **409**, `TABLE_CODE_LOCKED` là **423**. Khác nhau có chủ ý — một
cái là xung đột trạng thái, một cái là tài nguyên bị khoá tạm. Đừng "sửa cho nhất quán".

⚠ **Hành vi của khoá 423, phải làm đúng**: trong 15 phút bàn bị khoá, **MỌI** yêu cầu kèm `code`
cho bàn đó đều trả `TABLE_CODE_LOCKED` — **kể cả mã ĐÚNG**. Đây là đánh đổi đã biết: từ chối nhầm
người thật còn hơn mở cửa cho kẻ vẫn đang dò. Hệ quả cần chấp nhận: kẻ phá cố tình chạm ngưỡng
10-lần-sai có thể khiến bàn đó bị khoá lặp đi lặp lại suốt giờ cao điểm, và người cùng bàn hợp
pháp cũng không vào gọi thêm được. Lối thoát cho khách là nhờ nhân viên — nhân viên đọc được mã
từ drawer bàn (§2.5) và gọi món hộ như cũ.

⚠ **`TABLE_HAS_ONLINE_ORDER` — vì sao phải có (CRITICAL, soát bảo mật 2026-10-01).** Chuỗi khai
thác đã xác nhận bằng code: `transferTable` (`orders.service.ts:2158`) **không lọc `source`**, nên
nhân viên chuyển được một đơn `source='ONLINE'` — vốn mang `order_token` + `customer_name` +
`customer_phone` + `customer_address` — sang một bàn `dine-in` (ca thật: khách đặt ship rồi đổi ý
ngồi lại quán). `getOrCreateOpenOrder` tìm đơn mở **chỉ theo `table_id`**, không lọc `source`, nên
phiên khách sẽ gắn vào đúng đơn đó. Mà `order_token` là **credential DUY NHẤT** của
`DELETE /api/public/orders/:token` (`public-orders.controller.ts:117,141`) — người lạ dò trúng mã
bàn sẽ **huỷ được đơn của người khác** và đọc toàn bộ PII của họ. Chặn ở cửa `/table/open` là lớp
phòng thủ thứ hai; lớp thứ nhất là allowlist ở §1.3.

**Throttle riêng**: `@Throttle({ default: { limit: 10, ttl: 60_000 } })`. Nhánh **mã sai** đếm
thêm một bộ riêng: 5 lần/10 phút/IP (V2.4).

---

### 1.2 `POST /api/public/table/cart` — gửi lượt gọi

**Request**
```json
{
  "guest_token": "a3f1…",
  "client_request_id": "uuid-do-FE-sinh",
  "items": [
    { "menu_item_id": "…", "qty": 2, "note": "ít cay" },
    { "menu_item_id": "…", "qty": 1 }
  ]
}
```
| Field | Ràng buộc |
|---|---|
| `items` | 1–20 dòng |
| `qty` | số nguyên 1–20 (chặt hơn `MAX_QTY=99` của giỏ online — khách tại bàn không gọi 99 phần) |
| `note` | ≤ 255 ký tự |
| `client_request_id` | **Bắt buộc đúng dạng UUID v4**, server validate format. FE sinh **một lần** cho mỗi lượt, giữ nguyên khi retry. Ép format để implementer không nhận chuỗi rỗng/cố định làm giá trị hợp lệ — khi đó mọi lượt sau bị âm thầm nuốt (tự-DoS, trông y hệt bug) |

**Response `201`**
```json
{ "ok": true, "data": {
  "request_id": "…",
  "status": "WAITING",
  "guest_code": "7312",
  "items_preview": [
    { "name": "Phở bò", "qty": 2, "price_estimate": 50000 }
  ]
} }
```
⚠ `price_estimate` **phải** đi kèm nhãn *"giá tạm tính, chốt khi quán xác nhận"* — D-11 chốt giá
lúc nhân viên duyệt, nên con số này có thể khác số lên bill.

`guest_code` trả về ở **mọi** lượt, không chỉ lượt đầu — FE luôn hiện mã thường trực trên màn
(R10: `localStorage` hỏng thì khách vẫn đọc lại được mã).

**Gửi trùng**: đụng `UNIQUE (order_id, client_request_id)` → trả lại **chính `request_id` cũ với
HTTP 200**, không phải 409. Khách bấm hai lần hoặc mạng retry không được tạo hai lượt.

**Lỗi**

| HTTP | `code` | Khi nào |
|---|---|---|
| 400 | `VALIDATION_FAILED` | >20 dòng, `qty` ngoài 1–20, `items` rỗng |
| 401 | `GUEST_SESSION_INVALID` | Token sai / hết hạn / đã revoke |
| 410 | `SESSION_ENDED` | Đơn của phiên đã thanh toán hoặc bị niêm (chuyển bàn) |
| 404 | `MENU_ITEM_GONE` | Món không còn trong menu |
| 409 | `ITEM_OUT_OF_STOCK` | Món hết — `message` **kèm tên món** |
| 409 | `TOO_MANY_WAITING` | Bàn đã có 3 lượt chờ duyệt |
| 409 | `ORDER_CLOSED` | Đơn vừa bị đóng giữa chừng |
| 429 | `THROTTLED` | — |

**Việc server làm, theo thứ tự**
1. Kiểm phiên còn sống (V1.7).
2. `OrdersService.getOrCreateOpenOrder(table_id)` — **chống đua "hai người cùng gõ số bàn" miễn phí**, hàm này đã có `pessimistic_write` + dedupe phantom + retry.
3. Gắn `guest_session.order_id` nếu còn NULL; set `orders.first_guest_request_at` nếu còn NULL.
4. `ensureGuestCode(order_id)` — idempotent, đã có mã thì trả mã cũ.
5. Insert `table_order_requests` + `table_order_request_items` (**không ghi giá**).

---

### 1.3 `GET /api/public/table/state` — màn "Món của bàn"

**Request** — không body. Token ở **header**:
```
X-Guest-Token: a3f1…
```
Để ở header vì GET không có body, và **không đưa token lên URL** (cùng lý do `POST orders/lookup`
không cho SĐT lên URL — URL lọt vào log, lịch sử trình duyệt, referrer).

**Response**
```json
{ "ok": true, "data": {
  "table_name": "Bàn 5 — Sân sau",
  "guest_code": "7312",
  "waiting": [
    { "request_id": "…", "created_at": 1790824000000,
      "items": [ { "name": "Phở bò", "qty": 2, "note": "ít cay" } ] }
  ],
  "rejected_recent": [
    { "request_id": "…", "reason": "Món đã hết",
      "items": [ { "name": "Chả cá", "qty": 1 } ] }
  ],
  "ordered": [
    { "name": "Phở bò", "qty": 2, "unit_price": 50000, "line_total": 100000 },
    { "name": "Nem rán", "qty": 1, "unit_price": 45000, "line_total": 45000 }
  ],
  "subtotal": 145000,
  "calls": [ { "kind": "STAFF", "created_at": 1790824100000, "acked": false } ],
  "server_now_ms": 1790824200000
} }
```

⚠⚠ **ALLOWLIST, KHÔNG PHẢI BLACKLIST (CRITICAL).** Mapper **chỉ được** dựng đúng các field liệt
kê trong ví dụ trên và **KHÔNG BAO GIỜ** spread `order` / `orderItem`, kể cả một phần, kể cả
`{...order, id: undefined}`. Dùng `.strict().parse()` làm hàng rào thứ hai.

Danh sách được phép, hết:
`table_name` · `guest_code` · `waiting[].{request_id, created_at, items[].{name, qty, note}}` ·
`rejected_recent[].{request_id, reason, items[].{name, qty}}` ·
`ordered[].{name, qty, unit_price, line_total}` · `subtotal` ·
`calls[].{kind, created_at, acked}` · `server_now_ms`

**Vì sao phải là allowlist**: `orders` và `order_items` chứa những cột mà một lần spread là hỏng hẳn —

| Mức | Cột | Hậu quả nếu lọt |
|---|---|---|
| **CRITICAL** | `order.order_token` | Credential DUY NHẤT của `DELETE /api/public/orders/:token` → người lạ **huỷ đơn của khách khác**, đọc toàn bộ chi tiết đơn. Lọt vào được qua ca `transferTable` ở §1.1 |
| **HIGH** | `customer_name`, `customer_phone`, `customer_address` | PII thật của khách khác, cùng ca `transferTable` |
| MEDIUM | `payment_method`, `transfer_amount`, `paid_to_account_id`, `payment_qr_label`, `transfer_note`, `debt_note`, `debt_at`, `debt_paid_at`, `debt_paid_by_*`, `misa_copied_at`, `misa_ref`, `misa_copied_by_*` | Toàn bộ cụm kế toán / công nợ / đối soát |
| MEDIUM | `created_by_user_id`, `checked_out_by_user_id`, `misa_copied_by_user_id`, `debt_paid_by_user_id` | Định danh nhân viên nội bộ — danh sách cũ chỉ chặn `*_full_name` và **quên các cột `*_user_id`** |
| MEDIUM | `order_item.note` **nội bộ**, `cancelled_reason`, `served_by_full_name`, `cancelled_by_full_name`, `created_by_full_name`, `is_priority` | Ghi chú của BẾP/NHÂN VIÊN. ⚠ Khác hẳn `note` khách tự gõ — mapper phải tách rõ hai nguồn, trộn lẫn là lộ trao đổi nội bộ |
| LOW | `order.id`, `order_item.id`, `menu_item_id`, `order_id` | Định danh nội bộ |

Không có trạng thái bếp là **cố ý** (D-13): khách nhìn "đang nấu" rồi đếm phút là sinh ra đúng
loại câu hỏi mà M7 muốn giảm.

`ordered` gộp theo **tên và giá**, bỏ dòng đã huỷ và dòng ghi chú cho bếp (`is_note`).

**Lỗi**

| HTTP | `code` | Khi nào |
|---|---|---|
| 401 | `GUEST_SESSION_INVALID` | Token không tồn tại |
| 410 | `SESSION_ENDED` | Đơn đã thanh toán, hoặc bàn bị chuyển/niêm, hoặc phiên quá 8h |

FE gặp 410 → hiện *"Bàn này đã kết thúc, mời nhập lại số bàn"*, xoá `localStorage`, quay về màn gõ
bàn. **Không tự đoán bàn mới** (R2).

---

### 1.4 `POST /api/public/table/call` — gọi nhân viên / xin tính tiền

**Request**
```json
{ "guest_token": "a3f1…", "kind": "STAFF" }
```
`kind`: `"STAFF"` (gọi thêm đồ) | `"BILL"` (thanh toán).

**Response `202`**
```json
{ "ok": true, "data": { "call_id": "…", "cooldown_until": 1790824160000 } }
```

**Lỗi**

| HTTP | `code` | Ghi chú |
|---|---|---|
| 401 | `GUEST_SESSION_INVALID` | — |
| 410 | `SESSION_ENDED` | — |
| 429 | `CALL_COOLDOWN` | **Trả kèm `cooldown_until`** để FE hiện đồng hồ đếm ngược thay vì báo lỗi đỏ |

Cooldown **60 giây theo cặp `(order_id, kind)`** — bấm "Gọi nhân viên" rồi bấm ngay "Xin tính
tiền" vẫn được, vì khác `kind`.

---

## 2. Nội bộ — cho `apps/web` (JWT, quyền `admin` + `order`)

Đặt trong **`OrdersModule`** để dùng thẳng `OrdersService.addItemsBulk`.

⚠ **Phải thêm `/table-requests` và `/table-calls` vào danh sách tiền tố proxy CỨNG của
`apps/web/vite.config.ts`** — quên là màn bếp rỗng mà log API sạch.

### 2.1 `GET /table-requests/pending`

Màn bếp gọi trong **chính `Promise.all` 2 giây đã có**, không thêm vòng lặp mới.

```json
{ "ok": true, "data": {
  "requests": [
    { "id": "…", "table_code": "B05", "table_name": "Bàn 5 — Sân sau",
      "created_at": 1790824000000,
      "items": [
        { "menu_item_id": "…", "name": "Phở bò", "qty": 2, "note": "ít cay",
          "price_now": 50000, "out_of_stock": false },
        { "menu_item_id": "…", "name": "Chả cá", "qty": 1,
          "price_now": 85000, "out_of_stock": true }
      ],
      "total_now": 100000 }
  ],
  "calls": [
    { "id": "…", "table_code": "B05", "table_name": "Bàn 5 — Sân sau",
      "kind": "STAFF", "created_at": 1790824100000 }
  ]
} }
```

`price_now` và `total_now` là **giá hiện tại** (D-11). `total_now` **không cộng** dòng
`out_of_stock` — nhân viên thấy đúng số tiền sẽ vào bill.

Payload gần như rỗng khi không có gì chờ.

### 2.2 `POST /table-requests/:id/approve`

Không body.

```json
{ "ok": true, "data": {
  "added": 2,
  "skipped": [ { "name": "Chả cá", "reason": "OUT_OF_STOCK" } ],
  "order_id": "…"
} }
```

**Việc server làm, trong MỘT transaction**
1. `UPDATE table_order_requests SET status='APPROVED', decided_* WHERE id=? AND status='WAITING'`
   → **`affectedRows === 0` ⇒ 409 `ALREADY_DECIDED`**. Tuyệt đối không `SELECT` rồi `UPDATE`.
2. Đọc lại `orders.closed_at` **trong cùng transaction** → đã đóng ⇒ 409 `ORDER_CLOSED`.
3. Tách `ok[]` / `skipped[]` (V1.3) — **phải làm TRƯỚC** vì `addItemsBulk` fail-fast khi gặp món hết.
4. `ok` rỗng ⇒ đặt `status='REJECTED'`, trả 200 kèm `skipped` đủ 100%, **không gọi `addItemsBulk`**
   (nó ném `'Giỏ hàng trống'` khi mảng rỗng).

**Sau transaction**: `addItemsBulk(order_id, ok, send_to_kitchen = true, creator)` — món xuống bếp
luôn (D-10). Thừa hưởng miễn phí: validate món, dời mốc giờ-vào-bàn, `first_kitchen_at`, nhật ký
bàn `items_added`.

| HTTP | `code` |
|---|---|
| 409 | `ALREADY_DECIDED` — người khác vừa duyệt. FE hiện toast **trung tính**, không banner đỏ |
| 409 | `ORDER_CLOSED` — thẻ đổi thành *"Bàn đã thanh toán — lượt này không vào bill"* |
| 404 | `REQUEST_NOT_FOUND` |

### 2.3 `POST /table-requests/:id/reject`

```json
{ "reason": "Hết món" }
```
→ `{ "ok": true, "data": { "status": "REJECTED" } }` · 409 `ALREADY_DECIDED`.

⚠ **Cùng luật chống đua như `/approve`**: `UPDATE … WHERE id=? AND status='WAITING'` rồi kiểm
`affectedRows === 0`. **Không** `SELECT` rồi `UPDATE` — hai nhân viên cùng bỏ lượt, hoặc một người
duyệt trong lúc người kia bỏ, sẽ chồng lên nhau.

### 2.4 `POST /table-calls/:id/ack`

Không body → `{ "ok": true, "data": { "acked_at": 1790824150000 } }` · 409 `ALREADY_ACKED`.

⚠ **Cùng luật chống đua**: `UPDATE … WHERE id=? AND acked_at IS NULL` rồi kiểm `affectedRows`.
Không `SELECT` rồi `UPDATE`.

Ghi `acked_by_user_id` + `acked_by_full_name` để nhiều máy bếp thống nhất ai đã nghe (D-14).

### 2.5 `guest_code` vào payload drawer bàn

Không phải endpoint mới — thêm field `guest_code` (nullable) vào payload `GET /orders/by-table/:id`
đang có. Lý do: `localStorage` hỏng trên Safari private (ném lỗi **cả khi ĐỌC**) → khách mất token;
nhân viên phải đọc lại được mã giúp khách (R10).

---

## 2.6 Giới hạn phiên thiết bị — chống tích trữ `table_guest_sessions`

⚠ **HIGH, soát bảo mật 2026-10-01.** Việc `/table/open` không tạo `orders` (R1) chặn được bẩn bảng
`orders`, nhưng **mỗi lần gọi thành công vẫn ghi một dòng `table_guest_sessions`**. Một bàn trống
có thể bị mở đi mở lại vô hạn lần; trần duy nhất là throttle IP 10/phút, vượt qua dễ bằng 4G/VPN.
Kết quả: bơm hàng chục nghìn dòng mỗi ngày, phình bảng + index, **không để lại dấu vết nào ở
`orders`** nên R1 không nhìn thấy.

Ba lớp bắt buộc:

1. **Cron dọn** `table_guest_sessions` đã `expires_at < now` và `order_id IS NULL`, chạy hằng ngày.
   `expires_at` chỉ làm phiên **hết hiệu lực khi truy vấn** — nó không tự xoá dòng nào.
2. **Trần phiên sống chưa gắn đơn theo bàn**: tối đa 20. Vượt → `/table/open` **vẫn trả `OPENED`**
   nhưng tái dùng phiên gần nhất của cùng `ip_hash` thay vì tạo dòng mới. Không trả lỗi — khách
   thật không được chịu hậu quả của kẻ phá.
3. **Index `expires_at`** để job dọn chạy rẻ.

---

## 3. Năm điểm chống đua

| # | Tình huống | Cách chặn | Test chứng minh |
|---|---|---|---|
| 1 | Hai người cùng gõ số bàn | Gọi thẳng `getOrCreateOpenOrder` — đã có `pessimistic_write` + dedupe phantom + retry | có sẵn `open-order-lock.integration.test.ts` |
| 2 | Hai thiết bị cùng sinh mã | `ensureGuestCode` idempotent trong transaction khoá tập đơn mở | `table-guest-code.integration.test.ts` — 2 connection thật → **cùng một mã** |
| 3 | Khách bấm Gửi hai lần | `UNIQUE (order_id, client_request_id)` → trả lại `request_id` cũ, **200 chứ không 409** | `table-cart-dedup.integration.test.ts` — `COUNT(*)` = 1 |
| 4 | Hai nhân viên cùng duyệt | `UPDATE … WHERE status='WAITING'`, kiểm `affectedRows` | `table-approve-race.integration.test.ts` — đúng 1×200 + 1×409, `order_items` không nhân đôi |
| 5 | Duyệt đúng lúc thu ngân checkout | Đọc lại `closed_at` trong cùng transaction; `addItemsBulk` cũng tự chặn lần hai | nằm trong `table-approve-race` |

---

## 4. Một lượt đi từ đầu đến cuối

```
Khách quét QR  →  /thuc-don

1. Chọn món (giỏ ở localStorage, server CHƯA biết gì)
2. Bấm "Gọi món"  →  modal gõ số bàn
3. POST /table/open { table_input: "5" }
      → OPENED + guest_token          (bàn trống)
      → NEED_CODE                      (bàn đang dùng → hiện ô nhập mã bàn)
   ⚠ KHÔNG có dòng `orders` nào được tạo ở bước này
4. FE hiện "Bàn 5 — Sân sau" cỡ lớn, khách bấm xác nhận
5. POST /table/cart { guest_token, client_request_id, items }
      → tạo đơn (nếu bàn chưa có), sinh guest_code "7312", lượt vào WAITING
6. Màn khách hiện mã 7312 + "đang chờ quán xác nhận", poll GET /table/state mỗi 5s

                  ───── phía nhân viên ─────
7. Màn bếp poll 2s, thẻ "👤 KHÁCH BÀN 5 GỌI" hiện đầu panel Chờ chế biến
8. Bấm "✓ Duyệt cả lượt"  →  POST /table-requests/:id/approve
      → addItemsBulk(send_to_kitchen: true) → món xuống bếp NGAY
                  ──────────────────────────

9. Màn khách: lượt rời `waiting`, món hiện ở `ordered`, subtotal cập nhật
10. Khách gọi thêm → lặp bước 5 (cùng guest_token, client_request_id MỚI)
11. Người cùng bàn muốn gọi → gõ "5" → NEED_CODE → nhập "7312" → vào được
12. Khách bấm "Xin tính tiền" → POST /table/call { kind: "BILL" }
       → màn bếp đọc "Bàn 5 thanh toán"
13. Nhân viên checkout → orders.closed_at được set
       → mã 7312 chết, mọi guest_token của bàn rụng, GET /table/state trả 410
```
