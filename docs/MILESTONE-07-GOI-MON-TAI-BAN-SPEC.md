<!-- Spec M7 — Khách tự gọi món tại bàn. Viết lại TỪ TRẮNG 2026-10-01. -->

# Milestone 7 — Khách Tự Gọi Món Tại Bàn

> **Bản này thay thế hoàn toàn thiết kế cũ.** Nhánh `feat/qr-goi-mon-tai-ban` và
> `docs/MILESTONE-04-QR-DINE-IN-SPEC.md` đã bị chủ dự án bỏ hẳn ngày 2026-10-01 — lý do: code
> chắp vá sau 3 lần đảo ngược quyết định giữa chừng, nghiệp vụ muốn thiết kế khác, nhánh quá cũ
> so với `develop`. **Không tham chiếu bản cũ.** Milestone này bắt đầu từ con số 0.

- **Nhánh**: `feat/khach-order-tai-ban`, cắt từ `origin/develop` tại `f1d5775`
- **Worktree**: `/Users/m1macbook/Desktop/OrderQuanBaLun-khach-order-tai-ban`
- **Quy trình**: ECC — architect → planner → TDD → code-reviewer → security-reviewer

---

## 1. Mục tiêu

Khách ngồi trong quán quét một mã QR, gõ số bàn mình đang ngồi, rồi tự chọn món trên quyển menu
điện tử. Món không xuống bếp ngay: nhân viên thấy lượt gọi ở màn bếp và bấm một nút duyệt cả
lượt. Khách tự xem được bàn mình đã gọi gì, hết bao nhiêu tiền, và tự bấm gọi nhân viên hoặc xin
tính tiền mà không phải với tay gọi.

**Cái muốn giảm**: khách phải chờ nhân viên tới bàn mới gọi được món; khách hỏi "tôi gọi những
gì rồi", "hết bao nhiêu tiền"; nhân viên chạy đi chạy lại ghi món.

---

## 2. Quyết định đã chốt với chủ quán (2026-10-01)

### Luồng khách

| # | Quyết định | Vì sao |
|---|---|---|
| **D-01** | **Một mã QR CHUNG cho cả quán**, trỏ thẳng tới quyển menu `/thuc-don`. Không QR theo bàn. | In một lần, dán đâu cũng được. Đổi sơ đồ bàn không phải in lại gì. Đổi lại: hệ thống không tự biết khách ngồi bàn nào → sinh ra D-02. |
| **D-02** | Khách **gõ SỐ BÀN** vào ô nhập số để bắt đầu. Không chọn từ danh sách bàn, **không khai tên, không khai SĐT**. | Mỗi ô bắt khai là một chỗ khách bỏ cuộc. Gõ số bàn là thứ khách đọc được ngay trên mặt bàn. Không hiện danh sách bàn vì khách không cần thấy sơ đồ cả quán. |
| **D-03** | Bàn khách gõ **chưa mở đơn → hệ thống tự mở đơn mới** cho bàn đó. | Khách vừa ngồi xuống là gọi được ngay, không phải đợi nhân viên tới mở bàn. Đây là đúng cái milestone này muốn bỏ. |
| **D-04** | Sau lượt gọi đầu tiên, hệ thống sinh **MÃ BÀN 4 CHỮ SỐ** và báo khách: muốn người khác cùng bàn gọi thêm thì đưa mã này ra. | Mã bàn là chìa khoá của phiên ăn — vừa để người cùng bàn gọi thêm, vừa để chặn người lạ đọc bill (D-06). |
| **D-05** | Người thứ hai gõ **số bàn đang có phiên sống** → báo: *"Bàn này đang dùng rồi, vui lòng nhập mã bàn để gọi thêm."* Nhập đúng mã bàn mới gọi thêm và xem được bill. | Chặn hai chiều: (a) khách gõ nhầm số bàn không cướp được phiên của bàn khác; (b) người lạ không đọc được bill chỉ bằng cách gõ số bàn. |
| **D-06** | **Mã bàn sống đến khi THANH TOÁN XONG.** Nhân viên đóng đơn là mã chết, bàn trống trở lại, khách sau gõ số bàn đó lại được bình thường. | Phiên gắn với một lượt ngồi ăn, không gắn với đồng hồ. Bữa dài bao lâu cũng không bị văng giữa chừng. |
| **D-07** | **Món hết hàng: vẫn hiện, bôi mờ, không chọn được.** Không ẩn. | Ẩn thì khách tưởng quán không bán món đó và vẫn đi hỏi nhân viên — đúng việc milestone này muốn giảm. |
| **D-08** | Khách chọn món **ngay trên quyển menu `/thuc-don`**, không làm trang mới. | Quyển menu là thứ QR trỏ tới. Thêm một màn nữa giữa QR và việc chọn món là thêm một chỗ khách bỏ cuộc. |

### Luồng nhân viên

| # | Quyết định | Vì sao |
|---|---|---|
| **D-09** | Món khách gửi **KHÔNG xuống bếp ngay** — nằm ở trạng thái chờ duyệt. | Khách bấm nhầm, gõ nhầm bàn, hoặc gọi thừa thì bếp chưa nấu gì. Nhân viên là chốt chặn cuối. |
| **D-10** | Nhân viên duyệt **ngay trên MÀN BẾP**, bằng **MỘT NÚT duyệt cả lượt**. Không sửa số lượng, không bớt món tại đó. | Màn bếp là màn luôn bật trong quán. Một nút vì màn bếp đang bận và chật — muốn sửa thì nhân viên ra bàn làm trên màn gọi món như cũ. |
| **D-11** | **Giá chốt LÚC NHÂN VIÊN DUYỆT**, không phải lúc khách gửi. | Khớp cách màn gọi món hiện tại đang chạy (gọi món lấy giá hiện tại). Một nguồn sự thật về giá. |
| **D-12** | Khách có **nút gọi nhân viên** và **nút xin tính tiền**. Màn bếp **ĐỌC THÀNH TIẾNG VIỆT**: *"Bàn 5 gọi thêm đồ"* / *"Bàn 5 thanh toán"*. | Nhân viên đang bận tay không nhìn màn vẫn nghe được bàn nào. Chỉ chuông báo, không làm hàng chờ yêu cầu. |
| **D-13** | Khách **xem được món bàn mình đã gọi + tạm tính**. Không xem được tiến trình nấu. | Bỏ hẳn hai câu hỏi thường gặp nhất. Không hiện "đang nấu" vì khách nhìn rồi đếm phút là sinh ra đúng loại câu hỏi muốn giảm. |
| **D-14** | **Lượt gọi chuông lưu ở bảng thứ tư `table_calls`**, không giữ trong RAM của API. | ⚠ **Lỗ hổng do `ecc:planner` phát hiện 2026-10-01** — kiến trúc ban đầu khai `call_id` + `acked_at` ở API nhưng không có bảng nào chứa. Chọn bảng vì: (a) nhiều máy bếp phải thống nhất ai đã bấm "Đã nghe"; (b) API restart giữa ca mà mọi thẻ gọi biến mất là **đúng loại lỗi im lặng R7 sinh ra để tránh** — khách bấm gọi, chuông kêu, không ai tới, và không còn dấu vết nào. |
| **D-15** | **Công tắc riêng `table_ordering_enabled` trong cài đặt quán, mặc định TẮT.** | Phải tắt được mà không phải gỡ QR khỏi bàn (hôm đông quá, muốn nhân viên gọi tay cho chắc). Mặc định TẮT để triển khai lên server không tự bật tính năng chưa ai kiểm. `/api/public/table/open` đọc công tắc này ngay từ V2.3 để không phải sửa lại sau. |
| **D-16** | **Máy cũ quay lại bàn thì thấy mã ngay, không phải nhập lại.** FE luôn gửi kèm `guest_token` khi gõ số bàn; token còn sống và trỏ đúng đơn đang mở của bàn đó → trả thẳng mã. Máy lạ vẫn phải nhập mã. | Chủ quán hỏi 2026-10-01: *"mã vừa tạo nếu quên thì sao, vào lại bàn là thấy mã đó?"* Đúng cho máy cũ — đóng tab / hết pin / chuyển tab rồi quay lại là ca thường xuyên nhất trong một bữa, bắt máy đã có quyền nhập lại mã là làm khó đúng người hợp lệ. **Nhưng tuyệt đối không nới cho máy lạ**: gõ số bàn mà ra mã thì mã bàn mất sạch ý nghĩa, ai đi ngang cũng đọc được bill và gọi món vào bàn người khác — D-05 và lớp chống rò sụp theo. Ca mất `localStorage` thì server không phân biệt được với người lạ, lối thoát là nhân viên đọc mã từ drawer bàn; vì vậy mã phải hiện **thường trực** trên màn khách chứ không chỉ hiện một lần. |
| **D-17** | **Mã bàn sinh ở lần BÁO BẾP ĐẦU TIÊN của bàn, bất kể món do khách quét QR gọi hay nhân viên gọi hộ.** Mã hiện **xuyên suốt** ở màn "món đã chọn" của khách **và** ở màn order của nhân viên cho bàn đó. Nhân viên gọi hộ lần đầu xong, khách muốn gọi thêm thì nhân viên đọc mã đó cho khách. | ⚠ **Chủ quán chốt 2026-10-01, thay phương án cũ "sinh mã lúc khách gửi lượt đầu".** Phương án cũ để hở một trạng thái không ai nghĩ tới: bàn có đơn do nhân viên mở nhưng **chưa có mã** — khi đó ai gõ số bàn cũng vào được, đọc bill và gọi món vào bàn người khác. Gắn mã vào mốc "báo bếp lần đầu" xoá hẳn trạng thái đó, vì **mọi bàn đã có người ăn đều có mã, không ngoại lệ**. Luật cửa vào rút về một dòng: `guest_code IS NULL` = chưa ai gọi món = vào tự do; `guest_code IS NOT NULL` = đang có người ăn = phải nhập mã. **Chỗ móc đã có sẵn**: `markFirstKitchenIfNull` (`orders.service.ts:504`) — hàm private đã idempotent, được gọi từ đúng 4 đường đẩy món sang bếp (`:728`, `:851`, `:1182`, `:1242`). Sinh mã ngay trong đó thì không đường nào lọt. **Hệ quả chấp nhận**: lượt QR đầu tiên còn ở trạng thái chờ duyệt thì bàn chưa có mã, màn khách hiện "đang chờ quán xác nhận" và mã xuất hiện sau khi nhân viên duyệt. Đổi lại mã mang đúng nghĩa "bàn này có người ăn thật", và người lạ không chiếm được mã bằng cách gửi một lượt rác. |
| **D-18** | **Màn đầu khi quét QR: MỘT màn, ô gõ số bàn là chính**, kèm một dòng nhỏ "Đã có mã bàn? Nhập mã ở đây". Không có màn hỏi "bạn đã có bàn chưa" riêng. | Người cần nhập mã chỉ là người thứ hai trở đi; bắt mọi người đi qua một màn hỏi là thêm một lần chạm cho đa số. Gộp một màn vẫn rõ mà bớt thao tác cho người đầu tiên. |
| **D-19** | **Vòng đời mã bàn buộc vào `first_kitchen_at`** — đặt cùng nhau, xoá cùng nhau, copy cùng nhau. Bất biến: `guest_code IS NOT NULL` ⟺ `first_kitchen_at IS NOT NULL` ⟺ bàn đang có món thật. | Chủ quán rà ca xoá mã 2026-10-01 và nêu 4 ca; soi code ra thêm 4 ca nữa. Buộc vào một cột đã có sẵn thì chỉ phải nhớ MỘT luật thay vì 8 ca rời, và mọi đường mới thêm sau này tự động đúng. **Bảng ca đầy đủ ở §3.11.** |

### Ngoài phạm vi lần này

- Khách xem tiến trình từng món (đang nấu / xong) — chủ quán đã cân nhắc và bỏ.
- Khách tự thanh toán trong app — vẫn trả tại quầy / nhân viên thu như hiện tại.
- QR riêng theo từng bàn.
- Nhân viên quét QR trên máy khách thay cho gõ mã.

---

## 3. Kiến trúc

> Chốt bởi `ecc:architect` 2026-10-01. **Tiêu chí đã chọn phương án: không thêm trạng thái mới
> vào state machine, không đổi `orders.source`, không sửa `checkout()`.** Repo đang giữ BA bản
> sao state machine (`packages/schemas/src/orders.ts:66`, `orders.service.ts:56`,
> `OrderDrawer.tsx:77-119`) — thiết kế này không phải đụng dòng nào trong cả ba.

### 3.1 Phiên bàn — cột thêm vào `orders`, không bảng mới

D-06 nói mã bàn sống đúng bằng vòng đời đơn mở, mà `orders` đã có sẵn vòng đời đó
(`closed_at IS NULL`). Bảng riêng sẽ là nguồn sự thật thứ hai phải đồng bộ ở mọi ngả đóng đơn.

| Cột thêm vào `orders` | Kiểu | Ý nghĩa |
|---|---|---|
| `guest_code` | varchar(8) NULL | Mã bàn 4 chữ số. NULL = bàn chưa có phiên khách. |
| `guest_code_at` | datetime(6) NULL | Lúc sinh mã. |
| `first_guest_request_at` | datetime(6) NULL | Lượt gọi đầu của khách. |

- **KHÔNG thêm `'GUEST'` vào `orders.source`** — `stampSeatedAtOnFirstItem` chặn cứng
  `source !== 'STAFF'` (`orders.service.ts:455`) và `checkout()` rẽ nhánh theo `source === 'ONLINE'`
  (`:1344`). Đơn khách tự mở vẫn là `source='STAFF'`; cờ nhận biết là `guest_code IS NOT NULL`.
- **Không UNIQUE index trên `guest_code`** — 10.000 tổ hợp sẽ cạn sau ~200 ngày nếu tính cả đơn
  đã đóng. Duy nhất chỉ cần trong tập đơn ĐANG MỞ (vài chục dòng): sinh mã trong transaction
  khoá tập đó, CSPRNG, tối đa 50 lần thử. Loại `0000`, dãy toàn một chữ số, `1234`/`4321`.
- **Mã chết tự động khi `closed_at` được set**, vì mọi tra cứu đều kèm `closed_at IS NULL`.
  Không hook vào `checkout()`, không hook vào `sealAsCancelled`, không cron dọn. Đây là lý do
  chính chọn phương án này.
- Sinh mã **idempotent**: đã có mã thì trả lại mã cũ. Hai thiết bị gửi cùng lúc không ra hai mã.

### 3.2 Phiên thiết bị khách — bảng mới `table_guest_sessions`

Mã 4 số là bí mật **chia sẻ miệng** — nó nằm trên màn hình, ai đi ngang cũng đọc được. Không
được dùng nó làm credential cho mọi request sau đó. Mỗi thiết bị nhận `guest_token` 64 hex riêng
(cùng lệ với `order_token` và `customer_sessions.token`).

```
table_guest_sessions
  id, token varchar(64) UNIQUE, table_id INDEX,
  order_id NULL INDEX,          -- gắn LƯỜI, chỉ khi gửi lượt đầu
  expires_at (8 giờ), last_used_at, revoked_at NULL, ip_hash NULL, created_at
```

Phiên hợp lệ ⇔ chưa revoke **và** chưa hết hạn **và** (chưa gắn đơn **hoặc** đơn đó còn mở).
⇒ **Thanh toán xong là mọi thiết bị của bàn rụng cùng lúc**, không phải xoá gì.

### 3.3 Giỏ chờ duyệt — bảng riêng, KHÔNG phải `order_items`

```
table_order_requests
  id, order_id INDEX, guest_session_id, table_code (snapshot),
  client_request_id varchar(64),  UNIQUE (order_id, client_request_id),
  status 'WAITING'|'APPROVED'|'REJECTED'|'EXPIRED',
  created_at, decided_at, decided_by_user_id, decided_by_full_name, decided_reason
  INDEX idx_tor_waiting (status, created_at)

table_order_request_items
  id, request_id INDEX, menu_item_id, menu_item_name (snapshot để hiện khi món bị xoá),
  qty, note
  -- KHÔNG CÓ CỘT GIÁ. Cố ý.
```

**Không có cột giá chính là cách hiện thực D-11 ở tầng schema**: không có chỗ nào để giá-lúc-gửi
tồn tại, nên không có cách nào vô tình dùng nó.

**Vì sao không thêm state mới / không thêm cột cờ lên `order_items`:**

1. **Giá.** Cả hai cách đều buộc chèn dòng ngay lúc khách gửi, mà `order_items.menu_item_price`
   là `NOT NULL`. Hoặc ghi giá lúc gửi (phá D-11), hoặc ghi 0 rồi sửa lúc duyệt — một dòng tiền
   sai nằm trong bảng tiền, chờ một câu `SUM` nào đó đọc trúng.
2. **Diện ảnh hưởng.** Thêm state buộc sửa song song: `ALLOWED_TRANSITIONS` ở hai chỗ, bản sao
   thủ công trong `OrderDrawer.tsx`, `HAS_ALIVE_ITEMS_SQL` (bàn sẽ sáng "đang dùng" vì một lượt
   chưa ai duyệt), `computeCheckoutTotals`, `COOKED_STATES` của trừ kho, mọi báo cáo đếm theo
   state. Mỗi chỗ bỏ sót là một lỗi im lặng về tiền hoặc kho.
3. **Ngữ nghĩa.** `PENDING` nghĩa là "nhân viên đã gọi, chưa báo bếp". Lượt khách gửi là thứ
   khác hẳn: **chưa ai chấp nhận nó**.

**Giá phải trả:** duyệt = tạo dòng mới, nên `order_items.created_at` là giờ DUYỆT chứ không phải
giờ khách gửi. Giờ khách gửi nằm ở `table_order_requests.created_at`. Chấp nhận — và đúng hơn
cho màn bếp (bếp đo thời gian từ lúc món được nhận).

**Luồng duyệt = lớp mỏng trên `addItemsBulk`** — thừa hưởng miễn phí: validate món, dời mốc
giờ-vào-bàn, `first_kitchen_at`, nhật ký bàn `items_added`, và đúng hành vi nút "Báo bếp luôn"
nhân viên đã quen. ⚠ `addItemsBulk` **fail-fast** khi có món hết hàng (`orders.service.ts:693-698`)
nên khâu tách `ok[]` / `skipped[]` phải làm TRƯỚC.

### 3.4 API

Mọi endpoint khách nằm dưới `/api/public/table/*` → `CsrfOriginGuard` đã phủ sẵn, **không thêm
ngoại lệ path nào**. Không thêm code nào vào `FRIENDLY_VN` (message có số liệu động sẽ bị ghi đè).

**Công khai (khách):**

| Method + path | Input | Output chính | Lỗi |
|---|---|---|---|
| `POST /api/public/table/open` | `{table_input, code?}` | `{state:'OPENED', guest_token, table_name, has_code}` hoặc `{state:'NEED_CODE', table_name}` | 404 `TABLE_NOT_FOUND`, 409 `TABLE_AMBIGUOUS`, 409 `TABLE_NOT_DINEIN`, 409 `TABLE_KIOTVIET_LOCKED`, 403 `TABLE_CODE_WRONG`, 423 `TABLE_CODE_LOCKED`, 409 `STORE_CLOSED` |
| `POST /api/public/table/cart` | `{guest_token, client_request_id, items[]}` | `201 {request_id, status:'WAITING', guest_code, items_preview}` | 401, 409 `ORDER_CLOSED`, 404 `MENU_ITEM_GONE`, 409 `ITEM_OUT_OF_STOCK`, 409 `TOO_MANY_WAITING` |
| `GET /api/public/table/state` (header `X-Guest-Token`) | — | `{table_name, guest_code, waiting[], ordered[], subtotal, calls[]}` | 401, 410 `SESSION_ENDED` |
| `POST /api/public/table/call` | `{guest_token, kind:'STAFF'\|'BILL'}` | `202 {call_id, cooldown_until}` | 401, 429 `CALL_COOLDOWN` |

**Nội bộ (nhân viên, JWT):** `GET /table-requests/pending` · `POST /table-requests/:id/approve` ·
`POST /table-requests/:id/reject` · `POST /table-calls/:id/ack` · mã bàn gộp vào payload drawer.

Ghi chú hợp đồng:
- `GET state` dùng **header**, không body (GET không có body) và không đưa token lên URL.
- `table_input` là chuỗi khách gõ ("5", "05", "bàn 5") → **hàm thuần có test**: rút chữ số, so với
  chữ số rút từ `restaurant_tables.code` ('B05' → 5), chỉ xét `is_active AND kind='dine-in'`.
- Trần: ≤ 20 dòng/lượt, `qty` ≤ 20 (chặt hơn `MAX_QTY=99` — khách tại bàn không gọi 99 phần),
  ≤ 3 lượt WAITING cùng lúc/bàn.

**Chống đua — 5 điểm:**

1. Hai người cùng gõ số bàn → gọi thẳng `getOrCreateOpenOrder` (đã có `pessimistic_write` + dedupe phantom + retry).
2. Hai thiết bị cùng sinh mã → sinh mã idempotent trong transaction khoá tập đơn mở.
3. Khách bấm Gửi hai lần → `UNIQUE (order_id, client_request_id)`; đụng unique thì trả lại `request_id` cũ, **200 chứ không 409**.
4. Hai nhân viên cùng duyệt → `UPDATE ... WHERE id=? AND status='WAITING'`, kiểm `affectedRows === 0` ⇒ 409. **Không** `SELECT` rồi `UPDATE`.
5. Duyệt đúng lúc thu ngân checkout → đọc lại `closed_at` trong cùng transaction; thẻ bếp đổi thành "Bàn đã thanh toán — lượt này không vào bill".

### 3.5 Bảo mật

Bối cảnh: **một QR chung dán cả quán, không ràng buộc vật lý nào giữa người quét và cái bàn**
(hệ quả trực tiếp của D-01). Thiết kế với giả định kẻ xấu đứng ngoài vỉa hè vẫn quét được.

| # | Rủi ro | Chốt chặn |
|---|---|---|
| **R1** | Gõ bừa số bàn làm bẩn sơ đồ | **Tạo đơn LƯỜI.** `POST /table/open` KHÔNG tạo `orders` — chỉ phân giải bàn và cấp token. `getOrCreateOpenOrder` chỉ gọi ở `/table/cart`, khi đã có món thật. Quét QR gõ cả 30 số bàn không sinh một dòng DB nào. |
| **R2** | Dò mã 4 số (10.000 tổ hợp) | 5 lần sai/10 phút/IP + khoá theo BÀN 15 phút sau 10 lần sai (tự mở) + ghi `ip_hash`. ⇒ trung bình ~7 ngày liên tục từ một IP, trong khi phiên sống vài tiếng. **Dò trúng làm được gì — trần thiệt hại đầy đủ** (soát bảo mật 2026-10-01 bổ sung, bản đầu ghi thiếu): đọc **bill thật của người lạ** qua `GET /table/state` (rò riêng tư, không chỉ "xem bill" chung chung) · chiếm **1 trong 3 slot `TOO_MANY_WAITING`** bằng lượt rác, khoá tạm khách thật tới khi nhân viên bỏ lượt · **spam chuông** `BILL`/`STAFF` (chặn 60s/cặp nhưng không chặn hẳn) khiến nhân viên chạy ra bàn vì chuông giả — đúng phiền toái D-12 muốn tránh, bị lợi dụng ngược. Vẫn **không trừ tiền ai, không xuống bếp**. |
| **R3** | Giả mạo giá | Client không bao giờ gửi giá; bảng chờ không có cột giá; snapshot từ `menu_items` lúc duyệt. |
| **R4** | Spam gửi lượt | 3 lượt WAITING/bàn, 20 dòng/lượt, throttle theo `guest_token`, phiên 8h, chặn khi quán đóng cửa. |
| **R5** | Spam chuông | Cooldown 60s cho mỗi `(order_id, kind)`; vượt → 429 kèm `cooldown_until` để màn khách hiện đồng hồ thay vì báo lỗi đỏ. |
| **R6** | **Rate limit IP giết cả quán** | ⚠ CAO. `read-only-throttler.guard.ts:73-84` đã ghi rõ mọi thiết bị trong quán đi chung MỘT IP public, 5-6 máy nhân viên đã suýt chạm trần 600/phút. Thêm 20 khách poll 5s = **+240 req/phút trên cùng IP đó**. **BẮT BUỘC** override `getTracker` cho `/api/public/table/*` sang `guest:<token>`, nếu không tính năng này sẽ làm 429 nút "Báo bếp" của nhân viên. Phải có test tích hợp. |
| **R7** | Rò dữ liệu | `GET state` chỉ trả tên món / SL / giá / tạm tính của đúng bàn đó. Không trả `order.id` thật, không tên nhân viên, không nhật ký bàn. Mapper tường minh + `.strict().parse()`. |
| **R8** | PII | D-02 (không khai tên/SĐT) là món quà bảo mật: tính năng này **không tạo một trường PII mới nào**. Giữ nguyên, đừng thêm ô "tên khách" về sau. |
| **R9** ⚠ | **CRITICAL — rò `order_token` + PII khách qua đơn ONLINE bị chuyển vào bàn** | Soát bảo mật 2026-10-01, **đã xác nhận bằng code**. `transferTable` (`orders.service.ts:2158`) không lọc `source`; `getOrCreateOpenOrder` tìm đơn mở chỉ theo `table_id`. Khách đặt ship rồi ngồi lại quán → nhân viên chuyển đơn ONLINE vào bàn → phiên khách gắn vào đơn đó → nếu mapper spread thì `order_token` lọt ra, mà đó là credential DUY NHẤT của `DELETE /api/public/orders/:token`: người lạ **huỷ được đơn của khách khác** và đọc tên/SĐT/địa chỉ của họ. **Hai lớp chặn**: (1) mapper `GET state` phải là **allowlist tường minh**, cấm spread; (2) `/table/open` trả 409 `TABLE_HAS_ONLINE_ORDER` khi đơn mở của bàn có `source='ONLINE'`. |
| **R10** ⚠ | **HIGH — tracker `guest:<token>` một lớp tháo bỏ hẳn trần IP** | Mỗi token mint ra lại có nguyên hạn mức riêng ⇒ đổi rủi ro "quán chung IP" lấy rủi ro nặng hơn "một IP hạn mức vô tận". **Phải hai lớp**: per-token 60/phút + sàn IP 2000/phút không được miễn, và `/table/open` luôn tính theo IP 10/phút bất kể có token. |
| **R11** ⚠ | **HIGH — tích trữ `table_guest_sessions`** | R1 chỉ chặn bẩn bảng `orders`; mỗi `/table/open` thành công vẫn ghi một dòng session, mở lại vô hạn lần được. `expires_at` chỉ làm phiên hết hiệu lực **khi truy vấn**, không xoá dòng nào. Chặn: cron dọn phiên hết hạn chưa gắn đơn + trần 20 phiên sống chưa gắn đơn mỗi bàn (vượt thì tái dùng phiên cũ, **không trả lỗi** — khách thật không chịu hậu quả của kẻ phá) + index `expires_at`. |
| **R12** | MEDIUM — khoá 423 chặn luôn người gõ ĐÚNG mã | Đánh đổi đã chọn: từ chối nhầm còn hơn mở cửa cho kẻ đang dò. Kẻ phá có thể làm bàn bị khoá lặp lại suốt giờ cao điểm. Lối thoát: nhân viên đọc mã từ drawer bàn và gọi hộ. |

### 3.6 Màn bếp

**Chốt: THẺ chèn đầu panel `PENDING`**, không phải badge ở `.kds-top`.

- D-10 nói duyệt **ngay trên màn bếp** bằng **một nút**. Badge chỉ là con số; bấm vào phải điều
  hướng đi chỗ khác (đúng cách nút "🛎 Đơn online" đang làm) — trái thẳng yêu cầu.
- Panel `PENDING` đã có **đúng tiền lệ**: `.kds-cancel-card` (`KitchenPage.tsx:1391-1409`) — thẻ
  không-phải-món, nằm trên cùng, ở lại tới khi có người bấm. Dùng lại khuôn đó.
- `.kds-top` đã kín; màn hẹp nhét thêm là tranh chỗ với thứ đang chạy.

**Thẻ duyệt `.kds-guest-card`:** viền xanh dương/tím (**không đỏ** — đỏ là "đã huỷ"; **không cam**
— cam là `KITCHEN`) · dòng đầu cỡ lớn `👤 KHÁCH BÀN 5 GỌI · 2 phút trước` + đồng hồ chờ, nhấp
nháy sau 3 phút · thân `2× Phở bò — ít hành`, dòng món hết gạch ngang + nhãn `hết — sẽ bỏ`
**trước khi bấm** · chân `Tạm tính theo giá hiện tại: 185.000đ` · nút chính to hết bề ngang
**`✓ Duyệt cả lượt`** · nút phụ `✕ Bỏ lượt` (2 bấm xác nhận).

**Thẻ gọi `.kds-call-card`:** mỏng hơn, `🔔 BÀN 5 — GỌI THÊM ĐỒ` / `💵 BÀN 5 — THANH TOÁN`, một
nút `Đã nghe`.

**Cập nhật: POLLING, không SSE.** Màn bếp đã poll 2s và trong cùng một `Promise.all` gọi song song
`/orders` + `/menu/version` (`KitchenPage.tsx:380-384`). Thêm **đúng một** request thứ ba vào
chính mảng đó: không thêm vòng lặp, không thêm timer, không thêm kênh phải tự lo reconnect/backoff.

### 3.7 Chuông đọc tiếng Việt

- **Cơ chế:** Web Speech API (`speechSynthesis`, `lang='vi-VN'`). Module mới `apps/web/src/lib/voice.ts`
  dựng theo **đúng khuôn `apps/web/src/lib/bell.ts`**: `unlock()` / `speak()` / `dispose()`, mọi hàm
  bọc try/catch và **không bao giờ throw**.
- **Câu nói dựng ở FE** từ `table_name` + `kind` — BE không cần biết cách đọc. Tên bàn không bắt
  đầu bằng "Bàn" thì ghép thêm ("B05" → "Bàn 5").
- **Trình duyệt chặn phát trước tương tác:** dùng lại nguyên ngữ nghĩa mở khoá của `bell.ts` — nút
  `🔊 Đọc` trên `.kds-bar` + tự mở khoá im lặng ở cú bấm đầu tiên bất kỳ. Lựa chọn lưu localStorage theo máy.
- **`getVoices()` trả rỗng ở lần gọi đầu** trên Chrome — phải chờ `voiceschanged`. Không có giọng
  `vi-VN` (Windows thường thiếu) thì vẫn đọc giọng mặc định và **luôn kèm tiếng chuông trước câu nói**.
  Thẻ chữ trên màn mới là nguồn sự thật; giọng là lớp phụ.
- **Chống đọc lặp — 5 lớp:** dedup theo `call_id` (Set lưu localStorage, sống qua F5) · chỉ đọc call
  chưa `acked` · nhắc lại tối đa 2 lần cách 60s · gộp theo nhịp (5 bàn gọi cùng lúc → **một câu**
  "Bàn 3, bàn 5 gọi thêm đồ") · **nhiều máy bếp: công tắc đọc mặc định TẮT**, chủ quán bật trên đúng
  một máy — phải ghi vào docblock, nếu không sẽ bị báo là bug "3 máy đọc chồng nhau".

### 3.8 Quyển menu

**Ràng buộc cứng:** `MenuBookPage` chạy ở hai nơi và nhánh `menu.<domain>` **cố ý không có
`BrowserRouter`** (`apps/shop/src/main.tsx:93-110`). ⇒ **Tuyệt đối không `useNavigate`, không
`<Link>`, không route mới.** Toàn bộ UI mới là lớp phủ/modal dựng bằng state trong component.
Bật/tắt bằng công tắc cài đặt quán, không bằng host.

**Nút cộng — chỗ nguy hiểm nhất của cả thiết kế.** Cử chỉ lật bắt ở khung ngoài
(`MenuBookPage.tsx:865-878`), đã khá cẩn thận (ngưỡng 6px, bỏ qua khi khách đang cuộn,
`onClickCapture` nuốt click sau khi kéo). Nhưng đặt nút cộng giữa trang vẫn hỏng vì **ngón tay
hay bắt đầu vuốt từ đúng chỗ có nút**.

**Chốt (có thể bị thay bởi bản thiết kế lại ở §6):** không đặt nút cộng trên từng dòng món. Tap
vào món vẫn mở ảnh lớn như hiện nay, và **chính lớp ảnh lớn mang bộ đếm số lượng + ô ghi chú +
nút "Thêm vào giỏ"**. An toàn theo thiết kế: `onPointerDown` thoát ngay khi `preview` đang mở
(`MenuBookPage.tsx:427`) nên không có cử chỉ lật nào tồn tại trong lớp đó — nút to bao nhiêu cũng
được. Khách lớn tuổi thấy ảnh + tên + giá + nút trong cùng một màn.

**Giỏ: khoá riêng `qbl.table_cart.v1`, KHÔNG dùng lại `qbl.cart.v1`** (giỏ đó thuộc luồng
ship/pickup, TTL 24h — trộn vào là khách đặt ship hôm qua mở menu hôm nay thấy món "tại bàn").
Tái dùng các hàm thuần bằng cách tách `createCartStore(key)` thành factory, giữ nguyên chữ ký
`useCart()` để `CartPage`/`CheckoutPage` không phải đụng vào.

**Món hết hàng:** đã có sẵn — `is_out_of_stock` nằm trong payload công khai và BE cố ý không ẩn
(`public-menu.mapper.ts:22,27`). Chỉ cần bôi mờ + khoá nút. D-07 trùng khớp luật đang chạy.

⚠ **Proxy dev:** shop proxy khai `/api` bắt tất nên `/api/public/table/*` chạy ngay. Nhưng
`apps/web/vite.config.ts` liệt kê CỨNG 9 tiền tố và không có `/api` — **thêm controller nội bộ
`table-requests` thì PHẢI thêm tiền tố vào đó**, không thì màn bếp rỗng mà log API sạch.

### 3.9 Rủi ro đã biết

| # | Rủi ro | Mức | Xử lý |
|---|---|---|---|
| R1 | **Khách gõ nhầm số bàn** → món về bàn người khác. Không phát hiện tự động được. | CAO | Sau khi gõ số, hiện **tên bàn cỡ lớn** ("Bàn 5 — Sân sau") và bắt xác nhận. Thẻ duyệt ở bếp in tên bàn to nhất thẻ. |
| R2 | **Chuyển bàn** giữa lúc khách đang mở màn → phiên trỏ đơn đã bị niêm | TRUNG | `GET state` trả `410 SESSION_ENDED`; màn khách hiện "Bàn này đã kết thúc, mời nhập lại số bàn". Không tự đoán bàn mới. |
| R3 | **Bàn treo tự reset** (`isStaleOpenOrder`) → mã bàn chết giữa buổi | TRUNG | Như R2. Thêm: kiểm lại ngưỡng treo xem có dài hơn một bữa ăn không. |
| R4 | Giá đổi giữa lúc chờ duyệt (hệ quả D-11) | THẤP | Màn khách ghi rõ "giá tạm tính, chốt khi quán xác nhận"; thẻ duyệt luôn hiện giá HIỆN TẠI. |
| R5 | Món hết hàng lúc duyệt → lượt bị bỏ dòng | TRUNG | Thẻ duyệt gạch ngang + nhãn "hết — sẽ bỏ" **trước** khi bấm; sau khi duyệt `skipped[]` hiện trên màn khách. |
| R6 | **Rate limit IP giết cả quán** | CAO | `getTracker` → `guest:<token>`. Bắt buộc, có test tích hợp. |
| R7 | **Nhân viên quên duyệt** → khách ngồi chờ món không bao giờ xuống bếp | CAO | Đồng hồ chờ + nhấp nháy sau 3 phút + chuông nhắc lại. Cân nhắc badge số lượt chờ trên nav để máy Order cũng thấy. |
| R8 | **`synchronize: true` + DB dev dùng chung giữa worktree** → sync từ nhánh thiếu entity sẽ DROP bảng mới | CAO (lúc dev) | Chỉ THÊM, không đổi tên. Cảnh báo trong docblock entity. Sync DB dev từ nhánh có đủ entity. |
| R9 | Nhiều máy bếp cùng đọc tiếng | TRUNG | Công tắc mặc định TẮT, bật một máy. |
| R10 | **localStorage hỏng** (Safari private mode ném lỗi cả khi ĐỌC) → mất `guest_token` | TRUNG | Bọc try/catch mọi ngả; **mã bàn hiện thường trực** trên màn khách để nhập lại; nhân viên đọc được mã từ drawer bàn. |
| R11 | `KitchenPage.tsx` đang 2199 dòng | TRUNG | Khối duyệt + voice ra component/module riêng (`GuestRequestCards.tsx`, `lib/voice.ts`); KitchenPage chỉ render và truyền props. |
| R12 | Test API dùng chung DB dev → đỏ ngẫu nhiên | THẤP | Cô lập theo `client_request_id`/bàn riêng; hàm thuần test đơn vị không chạm DB. |

### 3.11 Vòng đời mã bàn — 8 ca phải xử (D-19)

**Bất biến phải giữ**: `guest_code IS NOT NULL` ⟺ `first_kitchen_at IS NOT NULL` ⟺ bàn đang có
món thật. Mọi ca dưới đây là hệ quả của bất biến đó.

| # | Ca | Mã chết bằng cách nào | Phải viết code? |
|---|---|---|---|
| 1 | **Thanh toán xong** | `closed_at` được đặt; mọi tra cứu mã đều kèm `closed_at IS NULL` | Không — tự động |
| 2 | **Huỷ cả bàn** | `sealAsCancelled` đặt `closed_at` (`orders.service.ts:188`) | Không — tự động |
| 3 | **Vào rồi thoát, không gọi gì** | Chưa báo bếp nên chưa có mã | Không — D-17 lo sẵn |
| 4 | **Huỷ từng món tới khi đơn trống** | ⚠ Đơn vẫn mở nên mã KHÔNG tự chết | **Có** — hết món sống thì xoá `guest_code` + `first_kitchen_at` |
| 5 | **Reset bàn treo, nhánh đơn rỗng** | ⚠ `orders.service.ts:361-374` dùng lại **chính dòng đơn cũ**, chỉ đặt `first_kitchen_at = null`, **giữ `closed_at` NULL** | **Có** — xoá `guest_code` ngay cạnh dòng `first_kitchen_at = null` (`:367`). Thiếu ca này là mã sống dai trên bàn đã trống, không báo lỗi gì, và khách sau ngồi vào bị hỏi mã mà không ai biết mã đâu |
| 6 | **Chuyển bàn** | ⚠ Copy sang dòng đơn KHÁC; `first_kitchen_at` được copy (`:2247`) nhưng mã thì chưa | **Có** — copy `guest_code` + `guest_code_at` sang `dest`. Thiếu thì khách đang ăn dở mất mã khi nhân viên dời bàn. Phiên thiết bị cũng phải trỏ sang `dest.id`, không thì khách nhận 410 |
| 7 | **Bếp huỷ hết món** (báo hết hàng) | ⚠ Cùng bản chất ca 4, khác đường vào | **Có** — dùng chung đường xử lý với ca 4 |
| 8 | **Mã bị lộ** (bàn bên nghe lỏm) | Không phải ca xoá — là thiếu chức năng | **Có** — nút "Đổi mã" trong màn bàn của nhân viên: sinh mã mới, mã cũ chết ngay, phiên thiết bị cũ bị revoke |

**Chỗ cài đặt**: `markFirstKitchenIfNull` (`orders.service.ts:504`, idempotent, gọi từ `:728`
`:851` `:1182` `:1242`) là nơi SINH mã. Ba chỗ còn lại phải sửa: `:367` (reset — xoá mã),
`:2247` (chuyển bàn — copy mã), và đường huỷ món (ca 4+7 — xoá khi hết món sống).

**Không có gộp bàn / tách bàn** trong app (đã kiểm) nên không phát sinh ca thứ 9.

### 3.10 Cố ý để NGOÀI phạm vi

Khách tự rút lượt đã gửi (giai đoạn 2) · khách tự thanh toán / QR chuyển khoản tại bàn · gộp/tách
bàn, chuyển bàn từ phía khách · thông báo đẩy khi món xong (poll 5s là đủ).

## 4. Lộ trình

Kế hoạch thi công chi tiết: **[MILESTONE-07-KE-HOACH.md](./MILESTONE-07-KE-HOACH.md)** — 33 việc,
mỗi việc một commit, có test-viết-trước cho từng việc.

| Giai đoạn | Nội dung | Số việc |
|---|---|---|
| 1 | Schema (3 cột + 4 bảng) + hàm thuần + unit test — không chạm UI | 9 |
| 2 | API công khai + nội bộ + throttle theo `guest_token` + test chống đua | 12 |
| 3 | Màn bếp: thẻ duyệt + thẻ gọi (chưa có tiếng) | 7 |
| 4 | `lib/voice.ts` + công tắc đọc tiếng Việt | 5 |
| 5 | Quyển menu | chờ bản thiết kế lại (mục 5) |

**Lưu ý mã lỗi** (nêu ra để không ai "sửa cho nhất quán"): `TABLE_KIOTVIET_LOCKED` là **409**,
`TABLE_CODE_LOCKED` là **423**. Khác nhau có chủ ý — một cái là xung đột trạng thái, một cái là
tài nguyên bị khoá tạm.

## 5. Thiết kế lại giao diện quyển menu

Chủ dự án yêu cầu 2026-10-01: thiết kế lại `/thuc-don` cho **sang trọng, dễ dùng, hợp mọi người
dùng điện thoại**. Làm qua OpenDesign, đề xuất **cả hai hướng** để chọn:

- **A — bỏ lật sách, cuộn dọc**: dễ nhất cho người lớn tuổi, không vuốt hụt thành thêm nhầm món.
- **B — giữ lật sách 3D**: giữ cảm giác quyển menu giấy.

Kết quả thiết kế có thể **thay §3.8** về chỗ đặt nút thêm món.

## 6. Vấn đề còn treo

- Ngưỡng `isStaleOpenOrder` có dài hơn một bữa ăn không (R3) — cần hỏi chủ quán.
- Có cần badge số lượt chờ trên nav của máy Order không (R7).
- Câu chữ tiếng Việt cho màn khách và các ca lỗi — chủ quán đọc lại sau khi chạy thật.
