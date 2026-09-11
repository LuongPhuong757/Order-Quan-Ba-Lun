# Milestone 4 — Khách Tự Gọi Món Tại Bàn Bằng QR

**Trạng thái:** ĐÃ IMPLEMENT cả 5 bước — 31 quyết định. **Đã chạy thật ở local**: MySQL thật,
API + 2 dev server, lái trình duyệt qua cả luồng khách lẫn luồng nhân viên. 108 integration
test / 14 file đều xanh.
**Ngày chốt:** 2026-09-10 · **Ngày implement + chạy thật:** 2026-09-11
**Nguồn:** Phiên thảo luận trực tiếp với chủ quán (5 vòng hỏi–đáp)
**Nhánh git:** `feat/qr-goi-mon-tai-ban` (worktree riêng — tính năng treo ngoài một thời gian rồi mới vào `develop`)
**Liên quan:** tái dùng gần như toàn bộ hạ tầng Milestone 2 (`apps/shop`, module `public`) — xem 5.1

---

## 1. Mục tiêu

**Bàn nhiều, nhân viên ít.** Hiện mỗi bàn cần một nhân viên đứng nghe đọc món và gõ vào máy.
Tính năng này đẩy phần *chọn món* sang khách, nhân viên chỉ còn *soát và báo bếp*.

Bài toán không phải "cho khách tự đặt hàng" — cái đó Milestone 2 làm rồi, cho ship và mang về.
Bài toán là **chuyển một giỏ hàng từ điện thoại khách sang máy nhân viên trong 5 giây**: không
mạng nội bộ, không tài khoản, không ghép cặp thiết bị.

Cách giải: **một mã 5 chữ số**. Khách đọc, nhân viên gõ, đơn tự điền.

### Vì sao không làm QR theo bàn

Đã cân nhắc và **từ chối**. QR dán riêng từng bàn (`/t/ban-05`) thì hệ tự biết bàn, nhân viên
không phải gõ gì — ít hơn hẳn một bước. Nhưng phải in lại toàn bộ QR mỗi lần đổi sơ đồ bàn, và
phải xử lý ca khách quét sai bàn hoặc bê QR sang bàn khác. Chủ quán chọn **một QR chung** đưa
thẳng vào trang menu.

Hệ quả phải chấp nhận: không có cách nào biết giỏ thuộc bàn nào, ngoài việc nhân viên gõ mã vào
đúng bàn đang mở. Toàn bộ mục 4 (preview bắt buộc) và M4.D-04 (số kiểm tra) sinh ra để bù chỗ này.

---

## 2. Quyết định đã chốt (locked)

> Mỗi quyết định có ID để phase artifacts tham chiếu. **Không đổi** mà không ghi vào `OVERRIDE-DEBT.md`.

### QR và luồng khách

| ID | Quyết định | Lý do |
|---|---|---|
| **M4.D-01** | **Một QR chung** cho cả quán, đưa thẳng đến trang menu. Không QR theo bàn, không nhúng mã bàn. | Chủ quán chọn. Đổi sơ đồ bàn không phải in lại gì. |
| **M4.D-02** | Khách **không khai gì cả**: không tên, không SĐT, không tự chọn số bàn. Mở QR là chọn món luôn. | Mỗi trường bắt khai là một chỗ khách bỏ cuộc. Nhân viên đứng ngay đó, không cần khách khai bàn. |
| **M4.D-03** | **Giỏ hàng KHÔNG gửi lên server lúc khách chọn món** — giỏ nằm ở `localStorage` như hiện tại. Server chỉ biết đến giỏ tại đúng khoảnh khắc bấm "Sinh mã". | Chốt vòng 5. Khách xem menu rồi bỏ đi thì server không sinh ra gì: không có hàng chờ để dọn, không có giỏ rác, không có bảng phình. Đây là quyết định làm nhẹ nhất toàn bộ thiết kế. |
| **M4.D-04** | Mã **5 chữ số, chữ số cuối là số kiểm tra (Luhn)**. Bốn số đầu ngẫu nhiên. | Gõ sai 1 chữ số thì gần như luôn ra "mã không tồn tại", thay vì trúng giỏ thật của bàn khác. Với QR chung, gõ trúng mã người khác = món ra sai bàn + ghi oan giờ vào ăn. |
| **M4.D-05** | Nút **"Sinh mã"** nằm ở trang giỏ hàng, chỉ hiện khi giỏ có món. Ai bấm cũng được — nhân viên, hoặc khách khi nhân viên tới bàn. | Mã chỉ tồn tại khi thật sự có người sắp gõ nó. |
| **M4.D-06** | Sau khi sinh mã, trang khách hiện mã **kiểu ô OTP** — 5 ô rời, số to — kèm đếm ngược hạn. | Chủ quán đưa ảnh tham chiếu: dialog OTP ngân hàng. Ô rời để đọc to từng số không bị nhầm. |
| **M4.D-07** | Có nút **"Sửa lại"** sau khi đã sinh mã → **huỷ mã cũ ngay** rồi quay về giỏ; sửa xong bấm sinh mã mới. | Trước khi sinh mã thì khách sửa giỏ tự do (chưa gửi gì lên server). Nút này chỉ cho ca đã sinh mã rồi mới muốn bớt món. Không có nó thì mã cũ vẫn sống và nhân viên có thể đổ vào bàn món khách đã bỏ. |
| **M4.D-08** | Mã lưu `localStorage` phía khách — đóng tab mở lại vẫn thấy mã, nếu còn hạn. | Rẻ, hạ tầng đã có (`customer-token.ts`). |
| **M4.D-09** | **KHÔNG làm màn "giỏ chờ" phía nhân viên.** Khách mất mã → sinh mã mới, hoặc đọc món trực tiếp. | Chủ quán chọn. Với M4.D-03 thì mã sống 15 phút và nhân viên đang đứng tại bàn, ca mất mã gần như không có. Có list còn thêm rủi ro nhân viên chọn sai giỏ. |
| **M4.D-10** | **Ghi chú từng món BẬT** ("ít cay", "không hành"). | `cart-store.ts` đã hỗ trợ `note` mỗi dòng — không phải làm gì thêm. |
| **M4.D-29** | Trang QR đọc **endpoint RIÊNG `GET /api/public/dine-in-menu`**, lọc theo ĐÚNG MỘT cờ `is_active` — bỏ qua cả `is_online_hidden` lẫn `is_menu_hidden`. | ⚠ **Phát hiện lúc implement (2026-09-11) — spec ban đầu ghi "dùng lại `/api/public/menu`" và như vậy là SAI.** `/menu` LOẠI HẲN món `is_online_hidden`, mà cờ đó nghĩa là "POS bán bình thường, web ship không bán" — tức đúng tập món **chỉ bán tại chỗ**: lẩu, món cồng kềnh không ship được. Khách đang NGỒI TRONG QUÁN mà không thấy những món đó thì tính năng mất đúng phần giá trị nhất, và khách vẫn phải gọi nhân viên. Khách ngồi bàn gọi món là bán tại chỗ → tập món phải khớp tập món POS bán. |
| **M4.D-30** | Luồng tại bàn có **giỏ hàng riêng** (`qbl.dinein.cart.v1`, TTL **4 giờ**) và **khung màn riêng** (`DineInShell`), tách hẳn giỏ + `AppShell` của web đặt online. | Thêm lúc implement. Giỏ chung là khách đang có đơn ship dở dang mà quét QR thì hai giỏ đè lên nhau — món tại bàn trộn vào đơn ship. TTL 4 giờ (không phải 24 giờ như giỏ online) vì giỏ tại bàn gắn với MỘT lượt ngồi ăn; quá 4 giờ là lượt khác, và giỏ hôm qua hiện lại lúc khách vừa ngồi xuống là đường ngắn nhất để món lạ lọt vào bill. Khung riêng vì `AppShell` mang nav "Đơn của tôi"/"Bảng xếp hạng", popup "quán tạm ngưng nhận đơn online", và icon giỏ trỏ giỏ ONLINE — cả ba đều sai với người đang ngồi ăn. |
| **M4.D-11** | **Món hết hàng: giữ nguyên hành vi hiện tại** — trang khách vẫn thấy, bôi mờ, kèm "Món này hôm nay tạm hết", không thêm được vào giỏ. **KHÔNG ẩn.** | Chủ quán đã cân nhắc việc ẩn và từ chối: ẩn thì khách tưởng quán không bán món đó và vẫn đi hỏi nhân viên — đúng cái việc tính năng này muốn giảm. Giữ nguyên M2.D-31, milestone này **không sửa gì** về món hết. |

### Vòng đời mã

| ID | Quyết định | Lý do |
|---|---|---|
| **M4.D-12** | Mã hết hạn sau **15 phút**. | Mã sinh khi nhân viên đã ở bàn → chỉ cần đủ cho vài phút soát món. Hạn càng ngắn thì càng ít mã cùng sống, càng ít nguy cơ gõ trúng mã người khác. |
| **M4.D-13** | Mã **dùng đúng 1 lần**. Nhập thành công là mã chết. Nhập lần hai trả: *"Mã đã dùng lúc 19:42 bởi Hà, bàn 5"*. | Điểm chí tử: nhập 2 lần = nhân đôi món của khách. Câu báo phải nói rõ ai và bàn nào, để nhân viên biết là chính mình vừa nhập hay người khác đã nhập. |
| **M4.D-14** | Mã chỉ **unique trong tập còn hiệu lực**. Hết hạn hoặc đã dùng thì số đó được cấp lại. | Bốn số đầu = 10.000 tổ hợp, mà số mã sống đồng thời chỉ vài cái. Không cần không gian lớn hơn. |
| **M4.D-15** | Nếu tập mã sống đã cạn (không tìm được số trống sau N lần thử) → trả lỗi rõ ràng. **Không** tự nới độ dài mã. | Ca này thực tế không xảy ra; nếu xảy ra thì là dấu hiệu bị lạm dụng, phải báo chứ không âm thầm đổi format mã. |

### Luồng nhân viên

| ID | Quyết định | Lý do |
|---|---|---|
| **M4.D-16** | Nhập mã **trong drawer của bàn** (`OrderDrawer`), không phải màn riêng. Modal 5 ô kiểu OTP, tự nhảy ô, nút "Xác nhận" lớn. | Nhân viên đang mở bàn nào thì đổ vào bàn đó — không có bước chọn bàn để mà chọn sai. |
| **M4.D-17** | **Preview BẮT BUỘC** trước khi đổ vào đơn. Phải hiện: giờ giỏ được sinh mã, số món, tổng tiền, và từng dòng món. | Với QR chung, đây là chốt chặn duy nhất giữa "gõ sai số" và "món ra sai bàn". Tổng tiền và giờ giúp nhân viên đang bận vẫn nhận ra giỏ lạ. |
| **M4.D-18** | Xác nhận → món vào đơn ở state **`PENDING`**. **Xác nhận KHÔNG phải báo bếp** — báo bếp vẫn là bước riêng đã có. | State machine đã có sẵn `PENDING → KITCHEN`, và món ở `PENDING` thì bếp không thấy. Đúng yêu cầu "chỉ ở mức xem và xác nhận, xác nhận rồi mới báo bếp" mà **không phải xây gì mới**. |
| **M4.D-19** | Bàn **đã có đơn mở** → món cộng thêm vào đơn đang ăn, không tạo đơn thứ hai. | Chủ quán chốt. Khách gọi thêm giữa bữa là ca thường xuyên nhất. |
| **M4.D-20** | **Giá chốt lúc nhân viên xác nhận**, không phải lúc sinh mã. Preview cảnh báo dòng lệch giá: `2 × Phở bò — 55.000đ ⚠ khách xem 50.000đ`. | Khớp cách POS đang chạy (gọi món lấy giá hiện tại) và khớp `syncCartWithMenu` ở luồng online. Cảnh báo là để nhân viên nói trước với khách, không để hệ thống tự quyết. Với hạn 15 phút thì ca này gần như không xảy ra. |
| **M4.D-21** | Món **hết hàng hoặc bị tắt khỏi menu** giữa lúc chờ → preview đánh đỏ dòng đó, cho **bỏ dòng và đổ phần còn lại**. Không chặn cả giỏ. | Chặn cả giỏ là bắt khách gọi lại từ đầu chỉ vì một món. Dùng lại logic `syncCartWithMenu` đã có. |
| **M4.D-22** | Quyền nhập mã: **`admin` + `order`**. | Cùng tập quyền với `items-bulk` hiện tại. |
| **M4.D-23** | `kiotviet_locked` **không xử lý riêng** — bàn bị khoá thì đã không mở được đơn, không tới được bước nhập mã. | Chủ quán xác nhận không cần chặn thêm. |

### Dữ liệu và an toàn

| ID | Quyết định | Lý do |
|---|---|---|
| **M4.D-24** | **Bảng riêng `dine_in_carts`. KHÔNG tái dùng `online_order_requests`.** | Bảng đó đang bắt buộc `customer_name`/`customer_phone`, `fulfillment_type` chỉ có `PICKUP` hoặc `DELIVERY`, và là nguồn của màn Đơn Online cùng toàn bộ thống kê online. Nhét giỏ tại bàn vào đó = phải nới NOT NULL và thêm điều kiện lọc trừ ở **mọi** query online đang chạy ổn định; quên một chỗ là báo cáo online sai âm thầm. |
| **M4.D-25** | **BE tự tra giá từ `menu_items`, tuyệt đối không tin giá client gửi lên** — cả lúc sinh mã lẫn lúc xác nhận. | Nguyên tắc đã có từ M2.D-42. Endpoint sinh mã là endpoint công khai, không auth. |
| **M4.D-26** | Chống lạm dụng: tối đa **5 lần sinh mã / thiết bị / giờ**, đếm trong DB theo **`customer_token` — KHÔNG theo `ip_hash`**; `qty ≤ 99` (đã có `MAX_QTY`). Không OTP, không SĐT. | ⚠ **Sửa lúc implement (2026-09-11).** Bản chốt ban đầu ghi "theo `customer_token` + `ip_hash`" — SAI và sẽ gây sự cố: cả quán dùng chung một wifi nên MỌI khách ra Internet bằng CÙNG MỘT IP công cộng. Hạn mức theo IP là hạn mức cho CẢ QUÁN — quán đông thì bàn thứ sáu trở đi không sinh được mã, và triệu chứng nhìn ra y như lỗi hệ thống. `ip_hash` vẫn được LƯU để truy vết, chỉ không dùng để chặn. Lớp chặn theo IP đã có sẵn và đủ rộng: throttler toàn cục 600 req/phút/IP. |
| **M4.D-27** | **KHÔNG kiểm công tắc nhận đơn online, KHÔNG kiểm giờ mở cửa** khi khách sinh mã. | Thêm lúc implement. Hai công tắc đó thuộc WEB ĐẶT HÀNG ONLINE: `online_ordering_enabled` là thứ chủ quán tắt khi bếp quá tải đơn ship, `open_hours` là giờ web nhận đơn từ xa. Khách quét QR thì ĐANG NGỒI TRONG QUÁN — quán mở là điều kiện hiển nhiên đã thoả. Gate theo chúng tạo ra đúng một triệu chứng: khách đang ăn bấm sinh mã và nhận lỗi "quán đang đóng", rồi gọi nhân viên — mất trắng mục tiêu của M4. Muốn tắt riêng QR thì phải là công tắc RIÊNG (xem Q-5). |
| **M4.D-31** | **Một thiết bị chỉ có ĐÚNG MỘT mã còn sống.** Sinh mã mới thì mọi mã còn sống của `customer_token` đó bị huỷ ngay trước khi cấp mã mới. | ⚠ **Phát hiện khi chạy thật trên trình duyệt (2026-09-11).** Từ màn hiện mã, khách bấm icon giỏ ở header quay lại giỏ rồi bấm "Sinh mã" lần nữa → hai mã cùng sống cho cùng một giỏ. Nhân viên gõ mã một: món vào bàn; gõ nốt mã hai: món vào bàn **lần thứ hai**. Đây là "nhân đôi món" mà M4.D-13 sinh ra để chặn, đi vòng qua cửa khác — M4.D-13 không đỡ được vì hai mã KHÁC NHAU, mỗi mã vẫn chỉ dùng một lần. Nút "Sửa lại" (M4.D-07) đã huỷ mã cũ nhưng đó chỉ là đường đi dự kiến; chặn phải nằm ở chỗ mọi đường sinh mã đều đi qua. |
| **M4.D-28** | **Từ chối** giỏ có cùng `menu_item_id` ở hai dòng (400), không tự gộp. | Thêm lúc implement. Không phải vì sạch dữ liệu mà vì bước `apply`: nhân viên bỏ dòng thì FE gửi `skip_menu_item_ids`. Một `menu_item_id` hai dòng thì "bỏ dòng này" là câu không có nghĩa xác định — sẽ bỏ cả hai hoặc bỏ sai dòng. `cart-store.ts` luôn dựng một dòng một món, nên ca này chỉ đến từ client tự gọi API. |

---

## 3. Luồng khách — `apps/shop`

```
Quét QR chung  →  /tai-ban
  → trang menu (DineInMenuPage)        ← MỚI; tái dùng CardItem + CategoryRail
  → chọn món, ghi chú từng món         ← tái dùng HÀM THUẦN của cart-store
  → trang giỏ (/tai-ban/gio)           ← MỚI
       [ Sinh mã cho nhân viên ]       ← MỚI
  → màn hiện mã kiểu OTP               ← MỚI
       ┌───────────────────────────┐
       │   MÃ GỌI MÓN CỦA BẠN      │
       │    4   2   7   1   3      │
       │  Đọc mã cho nhân viên     │
       │  Còn hiệu lực 14:32       │
       │       [ Sửa lại ]         │
       └───────────────────────────┘
```

**Chế độ tại bàn khác web đặt hàng online ở chỗ:** không có bước nhập tên/SĐT/địa chỉ, không
tính phí ship, không kiểm bán kính giao, không kiểm giờ mở web online. Chỉ kiểm quán có đang
mở hay không.

Sau khi mã bị dùng, màn khách chuyển sang *"Nhân viên đã nhận món của bạn"*. Đây là điểm nối
sang Q-1 (khách xem tiến trình món).

---

## 4. Luồng nhân viên — `apps/web`

```
Sơ đồ bàn → mở bàn 5 → OrderDrawer
  → [ Nhập mã khách ]                   ← MỚI, cạnh nút Gọi món
  → modal 5 ô OTP → gõ 4 2 7 1 3
  → PREVIEW (bắt buộc)
       Giỏ sinh mã 19:38 — 2 phút trước
       ─────────────────────────────────
       2 × Phở bò              110.000đ
       1 × Nem cuốn             45.000đ   ghi chú: ít cay
       1 × Rau muống xào    ❌ đã hết — [bỏ dòng]
       ─────────────────────────────────
       3 món · 155.000đ
       [ Huỷ ]        [ Thêm vào bàn 5 ]
  → món vào đơn ở PENDING
  → nhân viên soát → [ Báo bếp ]        ← bước đã có sẵn
```

### Hệ quả phải xử lý: giờ vào ăn

`opened_at` được dời về lúc món đầu tiên được gọi (`orders/seated-at.ts`, sửa 2026-09-10). Món
từ giỏ QR đổ vào ở `PENDING` **cũng dời mốc này** — đúng ý muốn, khách gọi món là khách đã ngồi.

Nhưng: gõ mã vào **sai bàn** thì bàn đó bị ghi giờ vào ăn oan. Phải đảm bảo huỷ được toàn bộ
món vừa đổ vào, và ghi nhật ký rõ ràng cho ca này.

---

## 5. Mô hình dữ liệu

### 5.1 Phần đã có sẵn — TÁI DÙNG, không làm lại

| Cần | Đã có ở đâu |
|---|---|
| Trang menu + giỏ khách | `apps/shop`: `MenuPage.tsx`, `CartPage.tsx`, `lib/cart-store.ts` |
| Đồng bộ giỏ với menu (giá đổi, món hết, món bị xoá) | `cart-store.ts::syncCartWithMenu` — dùng cho cả preview nhân viên |
| Token thiết bị khách | `apps/shop/src/lib/customer-token.ts` |
| Băm IP, không lưu IP thô | `public/ip-hash.ts` |
| BE tra giá, chặn món hết/ẩn/không active | `public/submit-order.ts` — mẫu để viết `create-cart.ts` |
| Đổ nhiều món vào đơn | `POST /orders/:id/items-bulk` |
| "Xem rồi mới báo bếp" | `order_items.state`, `PENDING → KITCHEN` |
| Nhật ký thao tác đơn | `order_activity_log` |

### 5.2 Bảng mới — `dine_in_carts`

Chỉ **một** bảng, không có bảng phụ.

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `code` | varchar(8), index | 5 chữ số. **Không** unique tuyệt đối — theo M4.D-14, unique chỉ trong tập còn hiệu lực; ép ở tầng service, index `(code, used_at, expires_at)` |
| `items_snapshot` | json | `[{menu_item_id, code, name, unit_price, qty, note}]` — cùng shape `OnlineOrderItemSnapshot` để dùng lại mapper |
| `subtotal` | int unsigned | VND, giá BE tra lúc sinh mã |
| `customer_token` | varchar(64), index | thiết bị khách, dùng cho rate-limit và kiểm quyền huỷ |
| `ip_hash` | varchar(64) | HMAC-SHA256; **không bao giờ lưu IP thô** |
| `user_agent` | varchar(255) | |
| `created_at` | datetime(6) | |
| `expires_at` | datetime(6), index | `created_at + 15 phút` |
| `cancelled_at` | datetime(6) null | khách bấm "Sửa lại" |
| `used_at` | datetime(6) null | |
| `used_by_user_id` | varchar(36) null | |
| `used_by_full_name` | varchar(128) null | snapshot, cho câu báo ở M4.D-13 |
| `used_table_code` | varchar(16) null | snapshot bàn đã đổ vào |
| `order_id` | varchar(36) null | đơn đã nhận món |

**Trạng thái suy ra từ cột, KHÔNG có cột `status`:** còn hiệu lực = `used_at IS NULL AND
cancelled_at IS NULL AND expires_at > now`. Bốn trạng thái mà thêm một cột enum thì sẽ có ca
enum lệch với mốc thời gian, và không ai biết bên nào đúng.

**Dọn rác:** bản ghi đã dùng hoặc hết hạn **giữ lại** để tra cứu và log, không xoá. Ước lượng
vài trăm dòng mỗi ngày — chưa cần job dọn ở phase 1.

---

## 6. API

### Công khai, không auth — cho `apps/shop`

| Route | Việc |
|---|---|
| `GET /api/public/dine-in-menu` | Menu cho trang QR — lọc theo ĐÚNG `is_active` (M4.D-29). `no-store` |
| `POST /api/public/dine-in-carts` | Nhận `[{menu_item_id, qty, note}]` + `customer_token`. BE tra giá, kiểm món hết/không active (**KHÔNG** chặn `is_online_hidden` — M4.D-29), kiểm rate-limit, sinh mã. Trả `{code, expires_at}` |
| `GET /api/public/dine-in-carts/:code` | Khách mở lại tab — trả trạng thái mã (còn hạn / đã dùng / đã huỷ / hết hạn) + hạn còn lại. **Không** trả thông tin bàn hay tên nhân viên |
| `DELETE /api/public/dine-in-carts/:code` | Nút "Sửa lại". Cần `customer_token` khớp mới huỷ được |

### Nhân viên, quyền `admin` + `order` — cho `apps/web`

| Route | Việc |
|---|---|
| `GET /api/orders/dine-in-carts/:code` | Preview: trả snapshot + đối chiếu menu hiện tại (giá lệch, món hết). **Không** đánh dấu đã dùng |
| `POST /api/orders/:id/dine-in-carts/:code/apply` | Đổ vào đơn. Nhận `skip_menu_item_ids` cho dòng bị bỏ. **Chiếm mã trước, thêm món sau** — xem dưới |

`GET` preview cố ý **không** tiêu mã: nhân viên gõ sai rồi thoát thì mã của bàn khác không bị
hỏng. Chỉ `apply` mới tiêu mã.

### Vì sao `apply` KHÔNG nằm trong một transaction duy nhất

Bản chốt ban đầu ghi "atomic trong một transaction". Lúc implement thì không làm được vậy mà
không tự chèn `order_items` bằng tay: `OrdersService.addItemsBulk` mở transaction của chính
nó, và nó là chỗ giữ 4 việc dễ quên (tra lại giá trong cùng transaction, dời mốc *giờ vào ăn*
theo món đầu tiên, gộp phần vào một dòng, ghi nhật ký "Gọi món"). Viết lại 4 việc đó ở đây là
hẹn ngày chúng lệch nhau.

Nên `apply` chạy **hai bước**, và thứ tự là chủ đích:

1. **Chiếm mã** bằng compare-and-set `UPDATE ... WHERE used_at IS NULL AND cancelled_at IS NULL`.
2. **Thêm món** bằng `addItemsBulk`.

Hỏng ở giữa thì nghiêng về phía nào — đây là toàn bộ lý do của thứ tự này:

- Chiếm mã trước, thêm món hỏng → mã bị đốt, KHÔNG món nào vào bill. Khách phải đọc lại món:
  khó chịu, nhưng nhìn thấy ngay. (Và code vẫn **nhả mã** khi `addItemsBulk` throw, vì nó là
  transaction nên hoặc thêm hết hoặc không thêm gì.)
- Thêm món trước, chiếm mã hỏng → món ĐÃ vào bill mà mã vẫn sống. Nhân viên khác gõ lại là
  **nhân đôi món của khách** — đúng điểm chí tử M4.D-13 sinh ra để chặn, và là loại lỗi không
  ai phát hiện cho tới lúc khách nhìn bill.

Compare-and-set nằm ở tầng DB chứ không phải đọc-rồi-ghi trong JS: đó là thứ làm hai nhân viên
gõ cùng lúc chỉ MỘT người thắng.

---

## 7. Nhật ký (bắt buộc — theo lệ của luồng online)

| Sự kiện | Ghi ở đâu |
|---|---|
| Khách sinh mã | `dine_in_carts` — bản ghi chính là log |
| Khách bấm "Sửa lại" | `cancelled_at` |
| Nhân viên gõ mã sai / mã đã dùng / mã hết hạn | `audit_log` — để phát hiện ca gõ mò |
| Nhân viên đổ giỏ vào bàn | `order_activity_log`: ai, mã nào, bàn nào, mấy món, có bỏ dòng nào |
| Dời giờ vào ăn do món QR | `order_activity_log` — đã có sẵn qua `seated-at.ts` |

---

## 8. Lộ trình — đã làm xong cả 5 (2026-09-11)

| Phase | Nội dung | Trạng thái |
|---|---|---|
| **1** | Entity `dine_in_carts` + Luhn + `create-cart.ts` | ✅ 32 unit test |
| **2** | 3 route công khai + `dine-in-menu` + 3 trang `apps/shop` + khung riêng | ✅ typecheck + build |
| **3** | Route preview + apply (chiếm mã trước) | ✅ 20 unit test; integration test **đã viết, CHƯA chạy** |
| **4** | Modal 5 ô OTP + preview trong `OrderDrawer` | ✅ typecheck + build |
| **5** | Nhật ký + audit theo mục 7 | ✅ |

### File đã thêm/sửa

**Thêm** — `packages/schemas/src/dine-in-carts.ts` · `public/entities/dine-in-cart.entity.ts` ·
`public/dine-in-code.ts` (+test) · `public/create-cart.ts` (+test) ·
`public/dine-in-carts.service.ts` · `public/public-dine-in-carts.controller.ts` ·
`public/public-menu.assemble.ts` · `orders/dine-in-apply.ts` (+test +integration test) ·
`orders/dine-in-staff.service.ts` · `shop/lib/dine-in-cart-store.ts` ·
`shop/components/DineInShell.tsx` · `shop/pages/DineIn{Menu,Cart,Code}Page.tsx` ·
`web/components/DineInCodeModal.tsx`

**Sửa** — `public-menu.controller.ts` (thêm `dine-in-menu`) · `public.module.ts` ·
`orders.module.ts` · `orders.controller.ts` (2 route + DTO) · `schemas/index.ts` ·
`shop/lib/use-api.ts` (`deleteJson` nhận body) · `shop/main.tsx` (3 route) ·
`web/components/OrderDrawer.tsx` (nút + modal)

### Đã chạy thật ở local (2026-09-11)

MySQL native cổng 3306 (`order_app`/`order_quan_balun`, 597 món thật), API build bằng `tsc` rồi
`node dist/main.js`, shop 5174 + web 5173, lái Edge headless qua CDP.

| Cửa chắn | Kết quả |
|---|---|
| `dine-in-apply.integration.test.ts` | ✅ **19/19** trên MySQL thật — gồm hai nhân viên gõ đồng thời chỉ một người thắng, và món vào ở `PENDING` |
| Toàn bộ integration test | ✅ 108/108 (14 file) |
| Unit test api / shop / web | ✅ 755 / 139 / 272 |
| Luồng khách trên trình duyệt | ✅ menu → giỏ → sinh mã → màn OTP 5 ô |
| Luồng nhân viên trên trình duyệt | ✅ đăng nhập → mở bàn → nhập mã → preview → thêm vào bàn |
| Đối chiếu DB sau khi thêm | ✅ 2 dòng `PENDING`, ghi chú "ít cay" giữ nguyên, giỏ đánh dấu đã dùng kèm người + bàn, 2 dòng nhật ký |
| Đo giao diện mobile 390×844 | ✅ 0 tràn ngang · 0 ô nhập <16px · 0 vùng bấm <36px |

**4 lỗi chỉ chạy thật mới thấy** (đã sửa, xem git log): thiếu `DineInCart` trong `data-source.ts`
nên `synchronize` không tạo bảng; hai mã cùng sống (M4.D-31); nút "Gõ mã khác" chữ trắng trên
nền trắng; ô ghi chú 14px làm iOS phóng trang.

### Còn lại

- Chủ quán đọc lại câu chữ tiếng Việt (Q-4).
- `pnpm lint` KHÔNG chạy được: `eslint` không được khai trong `package.json` nào và không có
  trong `node_modules` (cả ở repo chính) — gap sẵn có của repo, không phải do M4.
- `QtyInput` cao 20px (dưới ngưỡng vùng bấm) — component **dùng chung** với giỏ đặt online,
  sửa là đụng luồng đang chạy nên để riêng, không gộp vào M4.

---

## 9. Vấn đề còn treo

- **Q-1** — Khách xem tiến trình món của mình (đang nấu / xong): hạ tầng có sẵn
  (`public/order-progress.ts`) nhưng giỏ QR vô danh, phải nối mã ↔ đơn để khách tra được.
  **Phase sau**, không làm ở milestone này.
- **Q-2** — Thay vì gõ 5 số, cho nhân viên **quét QR trên máy khách** (khách hiện QR, nhân viên
  quét bằng máy mình) → bỏ hẳn khâu gõ và mọi rủi ro gõ sai. Cần camera và quyền truy cập, máy
  nhân viên phải có camera dùng được. Đáng làm sau khi luồng mã chạy ổn.
- **Q-3** — In QR: một QR chung thì dán ở đâu — standee mỗi bàn, in trên menu giấy, hay sticker
  mặt bàn. Việc vận hành, không ảnh hưởng code.
- **Q-4** — Câu chữ tiếng Việt cho màn hiện mã và các ca lỗi: đã viết bản đầu lúc implement,
  chủ quán cần đọc lại và sửa cho khớp giọng quán.
- **Q-5** — **Công tắc tắt riêng QR tại bàn.** Theo M4.D-27, luồng này cố ý không gate theo
  công tắc online nào, nên hiện tại KHÔNG có cách nào tắt nó ngoài việc bỏ QR khỏi bàn. Nếu
  chủ quán muốn tắt được từ màn Cài đặt (ví dụ hôm đông quá, muốn nhân viên gọi món tay cho
  chắc) thì cần một cột `dine_in_qr_enabled` riêng trong `store_settings`. Chưa làm vì chưa
  có yêu cầu — nhưng đây là thứ dễ cần tới sau tuần đầu chạy thật.
