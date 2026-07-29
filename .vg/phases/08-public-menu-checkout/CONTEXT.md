---
phase: "08-public-menu-checkout"
discussed_in: "2026-07-29"
participants:
  - "chủ quán"
  - "Claude Opus 5 (AI)"
generated: "2026-07-29"
source: "/vg:scope structured discussion (5 rounds + Deep Probe x6)"
phase_name: "Public Menu, Checkout & Công Tắc Nhận Đơn"
decision_count: 76
---

# Phase 08 — Public Menu, Checkout & Công Tắc Nhận Đơn — CONTEXT

Generated: 2026-07-29
Source: /vg:scope structured discussion (5 rounds + Deep Probe ×6)
Phase: 08-public-menu-checkout
SPECS reference: `.vg/phases/08-public-menu-checkout/SPECS.md`
FOUNDATION reference: `.vg/FOUNDATION.md`
Milestone spec: `.vg/MILESTONE-02-ONLINE-ORDERING-SPEC.md` (M2.D-01..71)
Design system: `apps/shop/DESIGN.md` + `apps/shop/src/styles/tokens.css`

## Decisions

**Namespace:** IDs là `P08.D-XX` (phạm vi phase, khác với F-XX cấp project trong FOUNDATION,
và khác M2.D-XX cấp milestone).

**Ghi chú đọc:** 4 quyết định là **bản sửa** cho quyết định trước đó trong cùng phiên
(P08.D-32 sửa P08.D-10, P08.D-59 sửa P08.D-51, P08.D-66 sửa P08.D-07/P08.D-23/P08.D-26, P08.D-67 sửa P08.D-34).
Bản sửa luôn thắng.

### P08.D-01: Xem menu không cần login, không hỏi PII trước
**Category:** business
**Decision:** Khách vào `order.<domain>/` xem được toàn bộ menu không cần đăng nhập và
không bị hỏi bất kỳ thông tin cá nhân nào trước khi thấy menu.
**Rationale:** Hỏi PII ở cửa làm rời trang 50–70% (M2.D-08). Vẫn thu đủ 100% thông tin ở
bước checkout.
**Quote source:** DISCUSSION-LOG.md#round-1
**Endpoints:**
- GET /api/public/store (auth: none, purpose: trạng thái nhận đơn + giờ mở cửa + SĐT quán)
- GET /api/public/menu (auth: none, purpose: cây nhóm hàng + món + bestseller_ids)
**Test Scenarios:**
- TS-01: mở `order.<domain>/` không login → thấy menu + dải nhóm hàng
  verification_strategy: automated

### P08.D-02: "Bán chạy" = top 10 theo số lượng 30 ngày, có cache và index
**Category:** technical
**Decision:** Lọc `is_note = 0 AND state = 'SERVED' AND menu_item_id IS NOT NULL`,
`GROUP BY menu_item_id`, join `menu_items.is_active = 1`, dùng lại `PAID_SQL`
(orders.service.ts:77). Cache in-memory 30 phút. Trả về **chỉ danh sách ID đã xếp hạng**,
không kèm qty/doanh thu. Dưới 5 món hợp lệ → ẩn hẳn section. Thêm index
`idx_orders_paid_closed(is_paid, closed_at)` + `idx_orderitem_menu_item(menu_item_id, state)`.
**Rationale:** `order_items` chứa dòng ghi chú (`is_note`, giá 0đ) và món `CANCELLED` vẫn
nằm trong đơn đã thanh toán — xếp theo số lượng thì "lấy bát cho khách" leo top 1. Báo cáo
nội bộ hiện có xếp theo doanh thu nên ghi chú tự chìm; xếp theo số lượng thì không.
Không index thì lọc `closed_at` phải quét toàn bảng vì `idx_orders_table` có `closed_at` ở
cột thứ hai.
**Quote source:** DISCUSSION-LOG.md#round-1
**Constraints:** Không trả qty/doanh thu ra endpoint công khai (M2.D-43).
**Test Scenarios:**
- TS-25: dòng ghi chú và món CANCELLED không xuất hiện trong bestseller_ids
  verification_strategy: fixture

### P08.D-03: Tìm kiếm bỏ dấu làm ở phía trình duyệt
**Category:** technical
**Decision:** Normalize `NFD` + bỏ dấu + `đ→d`, khớp cả `name` và `code`, từ 2 ký tự,
debounce 250ms, empty state "Không tìm thấy món nào" + nút xoá ô tìm. Không `LIKE` trên cột
`name`.
**Rationale:** `data-source.ts:20` chỉ set `charset: 'utf8mb4'`; trong `utf8mb4_general_ci`
thì `ú = u` nhưng **`đ ≠ d`** — gõ "dau hu" không ra "Đậu Hũ". Với tên món Việt thì `đ` xuất
hiện liên tục. `GET /menu` đã trả toàn bộ cây nên lọc phía client là chính xác 100% và không
thêm query nào.
**Quote source:** DISCUSSION-LOG.md#round-1
**UI Components:**
- SearchBox: ô tìm kiếm, debounce 250ms, tối thiểu 2 ký tự
**Test Scenarios:**
- TS-02: gõ "dau hu" (không dấu) → ra "Đậu Hũ"
  verification_strategy: automated

### P08.D-04: Giỏ hàng localStorage chỉ lưu ID + số lượng + ghi chú
**Category:** technical
**Decision:** Key `shop_cart_v1`, **chỉ** `{menu_item_id, qty, note}` — không lưu giá, không
lưu tên. TTL 24h **trượt** theo lần sửa cuối, `expires_at_ms` riêng, tách hẳn khỏi key
`customer_token` (vĩnh viễn). Khi restore: gọi `GET /menu`, giá đổi thì hiện "Giá món X đã
đổi 45k → 50k", món hết/không bán thì bỏ khỏi tổng + thông báo, **chặn checkout** tới khi
khách xác nhận.
**Rationale:** Giá chốt tại submit (M2.D-42). Nếu giỏ lưu giá thì khách thấy một số, đơn ghi
số khác. Chiều ngược lại tệ hơn: nếu backend nhận giá từ payload thì thành lỗ hổng sửa giá
phía client trên endpoint không auth.
**Quote source:** DISCUSSION-LOG.md#round-1
**UI Components:**
- CartLineList: danh sách dòng giỏ, badge trạng thái từng dòng
- CartSummary: tạm tính / phí giao hàng / tổng cộng
**Test Scenarios:**
- TS-03: bấm `+` 2 món → giỏ nổi hiện tổng tiền
  verification_strategy: automated
- TS-04: F5 lại trang → giỏ còn nguyên
  verification_strategy: automated

### P08.D-05: Trần số lượng 3 tầng, enforce ở backend
**Category:** business
**Decision:** **20 phần/món**, **30 dòng/đơn**, **100 phần/đơn**. Error code
`CART_QTY_LIMIT` + `CART_TOO_MANY_LINES`. Chạm trần → hiện "Đơn trên 20 phần/món vui lòng
gọi quán {SĐT}" + nút gọi 1 chạm.
**Rationale:** Trần theo dòng không chặn được spam: 50 dòng × 20 = 1000 phần vẫn qua. Và
khách đặt tiệc bị chặn ở 20 mà tách 2 đơn thì vướng "1 SĐT 1 đơn mở" → bế tắc hoàn toàn,
nên phải cho đường ra bằng nút gọi quán.
**Quote source:** DISCUSSION-LOG.md#round-1
**Test Scenarios:**
- TS-26: giỏ 31 dòng → CART_TOO_MANY_LINES; 1 món 21 phần → CART_QTY_LIMIT
  verification_strategy: automated

### P08.D-06: Backend validate món còn bán khi submit
**Category:** technical
**Decision:** Kiểm `is_active = true` tại `POST /orders` → `MENU_ITEM_UNAVAILABLE`, **trượt
cả đơn**, FE đánh dấu món đó trong giỏ để khách tự sửa.
**Rationale:** Đây là validate đầu vào, KHÔNG phải re-check tồn kho của phase 09. Không có
nó thì `items_snapshot` chứa món quán không bán nữa, hoặc 500 khi lookup giá.
**Quote source:** DISCUSSION-LOG.md#round-1
**Test Scenarios:**
- TS-15: giỏ 30 dòng, 3 món hết hàng → trả đủ 3 dòng trong `details.unavailable_items`
  verification_strategy: fixture

### P08.D-07: Đơn WAITING quá 45 phút thành EXPIRED
**Category:** business
**Decision:** Thêm `EXPIRED` vào enum status. Quá hạn → trang khách hiện "Quán chưa phản hồi,
vui lòng gọi {SĐT}". Cơ chế nhả khoá SĐT xem **P08.D-66** (bản sửa).
**Rationale:** Phase 08 ship trước phase 09 nên chưa có thông báo/leo thang. Không có
`EXPIRED` thì đơn treo vĩnh viễn **và khoá luôn SĐT đó mãi mãi** do luật 1 đơn mở/SĐT — khách
ngày mai không đặt được và tự khách cũng không sửa được.
**Quote source:** DISCUSSION-LOG.md#round-1
**Test Scenarios:**
- TS-16: đơn WAITING quá 45 phút → EXPIRED + SĐT được nhả khoá
  verification_strategy: faketime

### P08.D-08: Phạm vi khách sửa đơn khi WAITING
**Category:** business
**Decision:** Sửa được **món, ghi chú, tên, địa chỉ**. **SĐT khoá cứng** (là danh tính đơn).
Đổi PICKUP↔DELIVERY → buộc huỷ đặt lại. Luật validate lại xem **P08.D-35** (bản sửa).
**Rationale:** Nếu cho sửa SĐT thì khách gửi bằng số sạch rồi PATCH sang số đang blacklist —
đi vòng qua cả blacklist lẫn luật 1 đơn/SĐT.
**Quote source:** DISCUSSION-LOG.md#round-1
**Endpoints:**
- PATCH /api/public/orders/:order_token (auth: none + token, purpose: sửa đơn khi WAITING)
- DELETE /api/public/orders/:order_token (auth: none + token, purpose: khách tự huỷ)
**Test Scenarios:**
- TS-27: PATCH đổi SĐT sang số đang blacklist → bị chặn
  verification_strategy: automated

### P08.D-09: Chuẩn hoá SĐT trước mọi so khớp
**Category:** technical
**Decision:** Chuẩn hoá về **10 số bắt đầu bằng 0** (bỏ khoảng trắng/dấu chấm, `+84`→`0`)
**trước khi** so blacklist / đếm đơn mở. Dùng lại đúng regex `/^0\d{9}$/` của POS nội bộ
(orders.controller.ts:96). Một hàm duy nhất, dùng ở mọi call site.
**Rationale:** `0912345678`, `+84912345678`, `0912 345 678` hiện là 3 giá trị khác nhau →
blacklist và luật 1 đơn bị lách chỉ bằng cách gõ khác đi.
**Quote source:** DISCUSSION-LOG.md#round-1
**Test Scenarios:**
- TS-12: SĐT `+84912345678` trong blacklist → gửi bằng `0912345678` vẫn bị chặn
  verification_strategy: automated

### P08.D-10: Trùng SĐT thì mở lại đơn đang chờ
**Category:** business
**Decision:** ⚠️ **ĐÃ BỊ SỬA bởi P08.D-32** — quyết định gốc (chuyển khách sang trang đơn
đang mở khi trùng SĐT) mở lại lỗ hổng M2.D-10 đã cấm. Xem P08.D-32.
**Rationale:** Giữ lại để truy vết lịch sử quyết định.
**Quote source:** DISCUSSION-LOG.md#round-1

### P08.D-11: Giờ chốt đơn sớm hơn giờ đóng cửa
**Category:** business
**Decision:** Setting `last_order_before_close_min` mặc định **30**. Quá giờ đó → khoá nút
đặt + banner "Hôm nay quán hết nhận đơn online, mời bạn gọi {SĐT}".
**Rationale:** Nấu mất ~20 phút, ship mất ~15 phút. `store_settings` chưa có key nào cho việc
này — chỉ có `open_hours`, dùng để chặn submit đúng giờ đóng thì đơn cuối không kịp làm.
**Quote source:** DISCUSSION-LOG.md#round-1
**Test Scenarios:**
- TS-28: submit 21:31 khi quán đóng 22:00 và ngưỡng 30 phút → LAST_ORDER_TIME_PASSED
  verification_strategy: faketime

### P08.D-12: Ba ngưỡng ship, chặn thật
**Category:** business
**Decision:** `max_delivery_km` = 15 (xa hơn → ẩn DELIVERY, chỉ PICKUP + hiện SĐT),
`min_delivery_amount` = 100000 (chưa đủ → chặn kèm "thêm món cho đủ 100k, hoặc đến quán
lấy"), `large_order_amount` = 1000000 (vẫn nhận + ghi "quán sẽ gọi xác nhận trước khi làm").
Cả 3 là setting, đổi được không cần deploy. Phí ship cuối vẫn do admin chốt (M2.D-52).
**Rationale:** `free_ship_km` chỉ phân biệt miễn phí/có phụ phí, **không có giới hạn xa
nhất** — khách cách 35km vẫn gửi được đơn và web không hề nói quán không giao, đơn đó chắc
chắn bị từ chối ở phase 09. Chiều ngược lại: 1 tô 45.000đ ship 6km thì quán lỗ tiền xe.
**Quote source:** DISCUSSION-LOG.md#round-1
**Test Scenarios:**
- TS-20: cách quán 35km, chọn DELIVERY → ẩn DELIVERY, chỉ PICKUP + hiện SĐT
  verification_strategy: automated

### P08.D-13: Ghi chú không đổi tổng tiền, không có đặt trước theo giờ
**Category:** business
**Decision:** Ghi chú của khách **không bao giờ** làm đổi tổng tiền đã chốt. Phase 08
**không** có đặt trước theo giờ — ghi rõ dòng đó cạnh ô ghi chú.
**Rationale:** Khách sẽ gõ "thêm 1 trứng", "6h chiều mới giao". Không ghi rõ thì khách tưởng
quán đã nhận lời.
**Quote source:** DISCUSSION-LOG.md#round-1
**UI Components:**
- NoteField: ô ghi chú + dòng nhắc "ghi chú không làm đổi giá; đặt trước theo giờ vui lòng gọi quán"

### P08.D-14: Đồ có cồn bán bình thường
**Category:** business
**Decision:** Bán như mọi món khác — không kiểm tuổi, không thêm cờ ẩn khỏi menu online.
Giữ nguyên M2.D-16.
**Rationale:** Chủ quán chốt trực tiếp. Tradeoff có ý thức: trang công khai không login nên
không có bước xác thực tuổi nào.
**Quote source:** DISCUSSION-LOG.md#round-1

### P08.D-15: Máy dùng chung — giữ giới hạn gốc + 3 giảm thiểu
**Category:** business
**Decision:** Giữ M2.D-10 (`customer_token` là của **máy**, mất lịch sử khi đổi máy) + (a)
autofill vẫn điền sẵn nhưng ô SĐT hiện "Đặt cho số 0912***678?" + nút đổi, bắt xác nhận ở
lần đặt đầu trong ngày; (b) nút "Không phải tôi / xoá thông tin trên máy này"; (c) `/history`
che mạnh hơn — chỉ 4 số cuối SĐT và tên đường. Phạm vi xoá xem **P08.D-70**.
**Rationale:** iPad nhà bố autofill sẵn tên+SĐT của bố, con gái đặt đơn của mình → quán gọi
sai người; `/history` phơi đơn cả nhà cho ai cầm máy.
**Quote source:** DISCUSSION-LOG.md#round-1
**UI Components:**
- PhoneConfirmField: ô SĐT có dòng xác nhận "Đặt cho số 0912***678?" + nút đổi
- MaskedText: che PII theo mức cấu hình
- ClearDeviceButton: "Không phải tôi / xoá thông tin trên máy này"
**Test Scenarios:**
- TS-06: đặt lần 2 → tên/SĐT tự điền, có dòng xác nhận
  verification_strategy: automated

### P08.D-16: Widget công tắc hiện đúng trạng thái thực
**Category:** business
**Decision:** Dashboard hiện "Đang nhận đơn" / "Ngưng — sẽ tự bật lại 00:00 đêm nay" /
"Ngưng — ngoài giờ mở cửa, mở lại 09:00" / "Ngưng tới khi bật lại". Lần **tự bật lại 00:00
ghi audit log actor SYSTEM**.
**Rationale:** OFF "đến hết hôm nay" tự bật lại trong im lặng: chủ tắt vì hết nguyên liệu,
sáng mai nguyên liệu chưa về nhưng web đã nhận đơn lại.
**Quote source:** DISCUSSION-LOG.md#round-1
**Endpoints:**
- GET /api/admin/settings (auth: admin, purpose: đọc store_settings)
- PUT /api/admin/settings (auth: admin, purpose: ghi setting + audit log)
**UI Components:**
- OrderingStatusWidget: trạng thái nhận đơn + lý do + giờ tự bật lại
- SwitchCard, OffModeRadio: công tắc + kiểu OFF
**Test Scenarios:**
- TS-07: admin đổi công tắc OFF + lý do → 200 + audit log
  verification_strategy: automated
- TS-17: OFF "đến hết hôm nay" → qua 00:00 giờ VN tự ON lại
  verification_strategy: faketime

### P08.D-17: Ba module mới, không sửa logic orders
**Category:** technical
**Decision:** `public-orders`, `store-settings`, `phone-blacklist`. **Không sửa** logic
`orders` hiện có, chỉ thêm 2 index.
**Rationale:** `orders` là code đang chạy production cho POS; cách ly rẻ hơn sửa bug.
**Quote source:** DISCUSSION-LOG.md#round-2

### P08.D-18: Giữ 1 throttler global, override từng route
**Category:** technical
**Decision:** Giữ throttler `default` duy nhất trong `forRoot`, override từng route bằng
`@Throttle({default:{...}})`. GET công khai 60/phút/IP; `POST /session` 10/phút/IP;
`PATCH`+`DELETE` 20/giờ/IP.
**Rationale:** `@nestjs/throttler@^6.2.0` duyệt **mọi** định nghĩa cho **mọi** route — thêm
named throttler `{limit:5, ttl:1h}` vào `forRoot` sẽ giới hạn luôn `POST /orders` của POS nội
bộ ở 5 lần/giờ. Pattern override từng route là cách project đang dùng ở auth.controller.
**Quote source:** DISCUSSION-LOG.md#round-2
**Test Scenarios:**
- TS-22: cuộn menu vượt 60 req/phút → 429 + RATE_LIMITED + Retry-After
  verification_strategy: automated
- TS-29: POS nội bộ vẫn ở bucket 600/phút, burst 60 giây không có 429 nào
  verification_strategy: automated

### P08.D-19: Guard riêng cho POST /orders, chuẩn hoá SĐT trước khi đếm
**Category:** technical
**Decision:** Guard chỉ gắn vào `POST /orders`: 5/giờ/IP **và** 3/giờ/SĐT. `getTracker()`
chạy `normalizePhone` + regex rồi mới đếm; SĐT sai định dạng trả 422 **trước khi** đếm.
**Rationale:** Guard chạy **trước** `ValidationPipe` nên đọc body thô — `+84912345678` /
`0912345678` / `0912345678 ` là 3 key khác nhau, lách sạch luật 3 đơn/giờ/SĐT. Key dài tuỳ ý
do attacker kiểm soát cũng tích tụ trong storage in-memory.
**Quote source:** DISCUSSION-LOG.md#round-2

### P08.D-20: expires_at ghi lúc insert
**Category:** technical
**Decision:** `online_order_requests` thêm **`expires_at DATETIME`** ghi lúc insert, không
tính từ `created_at`. Giá trị xem **P08.D-68**. Cột chặn trùng xem **P08.D-26**.
**Rationale:** Query, index và cron phải cùng đọc **một** giá trị; tính lại từ `created_at` ở
từng call site là nguồn lệch.
**Quote source:** DISCUSSION-LOG.md#round-2

### P08.D-21: @nestjs/schedule in-process, sửa luôn 2 cron đang chết
**Category:** technical
**Decision:** Thêm `@nestjs/schedule`, dùng `@Cron` in-process. Cron mới: quét đơn WAITING
hết hạn (5 phút), ẩn danh hoá đơn cũ (hằng ngày). **Sửa luôn `cron-audit-retention` +
`cron-jti-cleanup`** đang không chạy được trên production.
**Rationale:** Ghi đè quyết định "không thêm npm package nào" — đổi lấy cron chạy thật, không
phụ thuộc crontab trên VPS hay bị reinstall. Script cron hiện có chạy
`node --import @swc-node/register/esm-register src/cli/...` nhưng runtime image chỉ copy
`dist` và cài `--prod` → thiếu cả `src/` lẫn `@swc-node/register`. Nghĩa là retention 90 ngày
của audit log (REQ-G, tiêu chí phase 01) **chưa bao giờ được thực thi**.
**Quote source:** DISCUSSION-LOG.md#round-2
**Test Scenarios:**
- TS-30: cron ghi heartbeat, `/health` thấy được khi cron chết
  verification_strategy: automated

### P08.D-22: Đơn cũ 90 ngày thì ẩn danh hoá, không xoá dòng
**Category:** technical
**Decision:** Null `customer_name`, `customer_phone`, địa chỉ, toạ độ; **giữ** timestamps,
`status`, `subtotal`, `items_snapshot`.
**Rationale:** Xoá cứng phá chính thứ phase 10 cần đọc để tính tỉ lệ chuyển đổi, và xoá luôn
lịch sử đơn của khách. Ẩn danh hoá bảo vệ dữ liệu cá nhân tốt hơn xoá vì vẫn giữ được số liệu.
**Quote source:** DISCUSSION-LOG.md#round-2
**Test Scenarios:**
- TS-31: đơn 90 ngày tuổi mất tên/SĐT/địa chỉ, `subtotal` còn nguyên
  verification_strategy: faketime

### P08.D-23: Hết hạn tính khi đọc + cron 5 phút ghi
**Category:** technical
**Decision:** Predicate tính khi đọc là nguồn sự thật; cron 5 phút ghi `EXPIRED` vào DB. Ảnh
hưởng tới khoá SĐT xem **P08.D-66** (bản sửa).
**Rationale:** Cron chết thì suy giảm nhẹ chứ không khoá SĐT.
**Quote source:** DISCUSSION-LOG.md#round-2

### P08.D-24: Giờ Việt Nam lấy bằng Intl, không đổi TZ tiến trình
**Category:** technical
**Decision:** Giữ tiến trình UTC (`data-source.ts:28` `timezone:'Z'`). `isStoreOpenNow` dùng
`Intl.DateTimeFormat(..., {timeZone:'Asia/Ho_Chi_Minh'})`; `@Cron` dùng option `timeZone`.
**KHÔNG** đổi `TZ` của container `api`.
**Rationale:** Grep `Ho_Chi_Minh|timeZone|process.env.TZ` trong `apps/` + `packages/` = **0
kết quả** — project chưa bao giờ cần giờ địa phương. `docker-compose.prod.yml:21` chỉ set
`TZ: UTC` cho mysql, và `node:20-alpine` **không có `tzdata`** nên set `TZ=Asia/Ho_Chi_Minh`
cũng âm thầm về UTC. Đổi TZ tiến trình sẽ đổi hành vi mọi `new Date()` của POS đang chạy
(báo cáo cuối ngày, auto-close bàn 10h). `Intl` chạy nhờ ICU có sẵn, không cần `tzdata`.
**Quote source:** DISCUSSION-LOG.md#round-2

### P08.D-25: store_settings giữ EAV, tự nạp mặc định khi boot
**Category:** technical
**Decision:** Giữ schema key/value theo §4.1 spec M2. `StoreSettingsService` có
`OnModuleInit` **upsert các key còn thiếu**. **Công tắc nhận đơn mặc định OFF** ở lần boot
đầu.
**Rationale:** Script seed hiện có (`package.json:17-18`) không chạy được trên prod — cùng
gốc lỗi với P08.D-21. Nên bảng sẽ tạo ra mà **rỗng**, và nếu code coi "thiếu công tắc = ON"
thì web nhận đơn trước khi chủ quán cấu hình gì.
**Quote source:** DISCUSSION-LOG.md#round-2
**Test Scenarios:**
- TS-32: boot 2 lần liên tiếp → đúng 20 key, giá trị chủ quán sửa không bị ghi đè, công tắc OFF ở lần seed đầu
  verification_strategy: automated

### P08.D-26: Cột open_phone_lock thường, không dùng generated column
**Category:** technical
**Decision:** `open_phone_lock VARCHAR(16) NULL` do service tự ghi (= `customer_phone` khi
`status='WAITING'`, = `NULL` khi đổi trạng thái) + UNIQUE index. Vai trò cuối cùng của cột
này xem **P08.D-66**.
**Rationale:** TypeORM 0.3.29 so `asExpression` với `GENERATION_EXPRESSION` mà MySQL 8 trả
về đã chuẩn hoá lại → không khớp → `synchronize` cố tạo lại cột **mỗi lần restart**; đổi
generated column đang mang UNIQUE thì rebuild bảng hoặc throw → **crash boot, kéo POS xuống
theo**.
**Quote source:** DISCUSSION-LOG.md#round-2

### P08.D-27: Khoá bất biến đúng 1 tiến trình API
**Category:** technical
**Decision:** Không cluster, không replicas. Cron ghi **heartbeat** (`last_run_at` mỗi job) để
`/health` thấy được cron chết. Thêm `healthcheck` cho service `api`. **Sửa dòng
`deploy.api: rsync + pm2 reload` trong FOUNDATION §9.1** — không còn đúng, đang chạy Docker.
**Rationale:** Throttler in-memory, cache in-memory và `@Cron` đều đúng chỉ khi có 1 tiến
trình. Nhiều tiến trình → cron chạy trùng, bộ đếm throttle chia N, cache lệch nhau, và 2
tiến trình tranh nhau `synchronize`.
**Quote source:** DISCUSSION-LOG.md#round-2

### P08.D-28: Bốn lớp bảo vệ pool DB
**Category:** technical
**Decision:** (a) cache in-memory cả đường đọc công khai, xoá cache khi sửa menu; (b) bật lại
`etag` + `Cache-Control` **chỉ** cho `/api/public/*` (chi tiết ở P08.D-34); (c) `@Throttle`
GET công khai **60/phút/IP**; (d) **`DataSource` riêng 10 kết nối** cho `/api/public/*`.
**Rationale:** `data-source.ts:32` đặt `connectionLimit: 50` và comment ghi rõ ceiling này đã
phải nâng một lần vì POS poll 2 giây làm cạn pool. Giờ trỏ traffic internet vô danh vào cùng
pool đó. `app.set('etag', false)` (main.ts:31) tắt cache HTTP toàn hệ thống.
**Quote source:** DISCUSSION-LOG.md#round-2

### P08.D-29: 429 phải có đường ra cho khách
**Category:** technical
**Decision:** Response 429 hiện "Bạn thao tác hơi nhanh, thử lại sau ít giây — hoặc gọi quán
{SĐT}" + nút gọi. Thêm error code rate-limit vào `errors.ts`.
**Rationale:** Khách VN dùng 4G chung IP qua CGNAT nên 60/phút/IP có thể chặn oan khách thật;
phải luôn còn đường gọi điện.
**Quote source:** DISCUSSION-LOG.md#round-2

### P08.D-30: Mười endpoint chốt
**Category:** technical
**Decision:** Route tĩnh `/orders` khai **trước** `/orders/:order_token` trong NestJS.
**Rationale:** Thứ tự khai báo quyết định route nào match trước.
**Quote source:** DISCUSSION-LOG.md#round-3
**Endpoints:**
- GET /api/public/store (auth: none, purpose: trạng thái quán)
- GET /api/public/menu (auth: none, purpose: menu + bestseller_ids)
- POST /api/public/session (auth: none, purpose: sinh/nhận customer_token)
- POST /api/public/orders (auth: none, purpose: gửi đơn)
- GET /api/public/orders/:order_token (auth: none + token, purpose: trạng thái đơn)
- PATCH /api/public/orders/:order_token (auth: none + token, purpose: sửa đơn khi WAITING)
- DELETE /api/public/orders/:order_token (auth: none + token, purpose: khách tự huỷ)
- GET /api/public/orders (auth: none + X-Customer-Token, purpose: lịch sử thiết bị)
- GET /api/admin/settings (auth: admin, purpose: đọc setting)
- PUT /api/admin/settings (auth: admin, purpose: ghi setting)
- GET /api/admin/phone-blacklist (auth: admin, purpose: liệt kê blacklist)
- POST /api/admin/phone-blacklist (auth: admin, purpose: thêm SĐT)
- DELETE /api/admin/phone-blacklist (auth: admin, purpose: xoá SĐT)
**Test Scenarios:**
- TS-33: `/orders` và `/orders/:token` cùng tồn tại, không cái nào che cái nào
  verification_strategy: automated

### P08.D-31: Response đơn là discriminated union 5 trạng thái
**Category:** technical
**Decision:** `EXPIRED` trả `{status, expired_at_ms, message, store_phone, items, subtotal}`
— vẫn hiện danh sách món để khách đọc lại rồi gọi đặt nhanh. **Không** trả `percent`/`stage`.
Union phủ WAITING / EXPIRED / CONFIRMED / REJECTED / CANCELLED_BY_CUSTOMER, mỗi nhánh có
`store_phone`, nhánh REJECTED có `reject_reason`.
**Rationale:** §6 spec M2 chỉ đặc tả nhánh có tiến độ; phase 08 chưa có tracking nên phải có
shape riêng, và trả 404/410 khô sẽ làm khách tưởng mình vào sai link.
**Quote source:** DISCUSSION-LOG.md#round-3
**UI Components:**
- StatusCard: trạng thái đơn theo union, có lý do từ chối khi REJECTED
- CallStoreButton: nút gọi quán 1 chạm

### P08.D-32: Trùng SĐT trả 409 không kèm token; chống bấm 2 lần bằng client_request_id
**Category:** technical
**Decision:** **Sửa P08.D-10.** `POST /orders` trùng SĐT → `409
ORDER_ALREADY_OPEN_FOR_PHONE`, **không kèm token, không kèm món**, chỉ kèm `store_phone`.
Server đối chiếu: đơn đang mở có **cùng `customer_token`** thì mới trả token để mở lại. Chống
bấm 2 lần dùng **`client_request_id`** (UUID do FE sinh mỗi lần mở checkout) + UNIQUE cùng
`customer_token`.
**Rationale:** Lỗi trùng khoá UNIQUE chỉ mang 1 bit "có đơn WAITING với SĐT này" — không biết
của ai, giỏ nào. Trả về đơn đó biến `POST /orders` thành máy tra cứu, mở lại đúng lỗ hổng
**M2.D-10 đã cấm**: *"KHÔNG làm cơ chế tra lịch sử bằng SĐT — tránh lỗ hổng 'biết SĐT = xem
được đơn người khác'"*. Cũng sai về đúng đắn: khách gửi 6 món có thể nhận về đơn 2 món từ 20
phút trước. `client_request_id` chứng minh được "cùng máy cùng lần gửi", điều khoá SĐT không
bao giờ chứng minh được.
**Quote source:** DISCUSSION-LOG.md#round-3
**Test Scenarios:**
- TS-13: máy A gửi đơn, máy B gõ cùng SĐT → 409 **không kèm** order_token
  verification_strategy: automated
- TS-14: 2 request POST /orders song song cùng SĐT → chỉ 1 đơn WAITING trong DB
  verification_strategy: automated

### P08.D-33: Sửa tầng báo lỗi
**Category:** technical
**Decision:** (a) thêm `details?: Record<string, unknown>` vào `ErrorEnvelope`; (b) sửa
`global-exception.filter.ts:87` thành `if (!body.message && FRIENDLY_VN[code])`; (c) subclass
`ThrottlerGuard` throw đúng `RATE_LIMITED` + header `Retry-After`; (d) **bỏ**
`TOO_MANY_REQUESTS` (trùng nghĩa) và **bỏ** `NO_TABLE_AVAILABLE` (phase 09).
**Rationale:** `ErrorEnvelope` không có field nào chứa dữ liệu máy đọc được. Dòng 87 ghi đè
vô điều kiện nên mọi message có số liệu (SĐT quán, số tiền) bị nuốt. Và `mapStatusToCode(429)`
trả `AUTH_RATE_LIMITED` → khách cuộn menu hơi nhanh nhận đúng câu *"Bạn thử đăng nhập sai
nhiều quá. Đợi 15 phút rồi thử lại nhé."*
**Quote source:** DISCUSSION-LOG.md#round-3
**Test Scenarios:**
- TS-34: snapshot đóng băng error envelope cho 401/403/404/409/422/429 từ endpoint POS hiện có
  verification_strategy: fixture

### P08.D-34: Cache có chọn lọc, token rời khỏi query string
**Category:** technical
**Decision:** (a) cache **chỉ** `GET /store` và `GET /menu`; mọi `/api/public/orders*` trả
`Cache-Control: no-store, private` + `Vary`; (b) `customer_token` chuyển sang header
**`X-Customer-Token`**; (c) 2 mức cache tách rời — `bestseller_ids` 30 phút, menu tree ≤30
giây, ghép lúc trả response; **lọc `bestseller_ids` theo `is_out_of_stock`/`is_active` lúc trả
về**. ETag xem **P08.D-67** (bản sửa). Tự tính ETag trong `PublicCacheInterceptor`, **không**
bật lại etag toàn cục.
**Rationale:** Caddyfile ghi nguyên URI vào `docker logs` nên `customer_token` trong query
string là rò rỉ token vĩnh viễn, thêm nữa lọt vào lịch sử trình duyệt và `Referer`. Gộp
bestseller vào cùng cache với menu làm cờ hết hàng bị đóng băng theo TTL 30 phút, trong khi
`toggle-stock` của bếp là mutation thường xuyên nhất.
**Quote source:** DISCUSSION-LOG.md#round-3

### P08.D-35: PATCH là full replace, tách luật validate
**Category:** technical
**Decision:** Thay thế toàn bộ `{items, customer_note, customer_name, customer_address}`. Bắt
buộc `expected_updated_at_ms`, lệch thì `409 CONFLICT` kèm đơn hiện tại. Trả về **đơn đầy
đủ** cùng shape GET. Re-freeze snapshot theo giá hiện tại và trả delta. **Chỉ thay đổi làm
tăng** đơn mới bị check giờ mở cửa; **bớt món và `DELETE` luôn được phép khi còn WAITING**.
**Rationale:** Sửa P08.D-08 phần "validate lại toàn bộ" — luật cũ khiến khách muốn bớt món
lúc 22h05 bị chặn bởi `LAST_ORDER_TIME_PASSED`, không bớt được mà cũng không huỷ được. JSON
merge trên mảng vốn là full replace nên hợp đồng mơ hồ sẽ bị hiểu 2 kiểu.
**Quote source:** DISCUSSION-LOG.md#round-3
**Test Scenarios:**
- TS-21: bớt món lúc 22h05 (quá giờ chốt đơn) → được phép
  verification_strategy: automated

### P08.D-36: Thêm route /mon/:code
**Category:** technical
**Decision:** Trang chi tiết món **riêng** (không phải modal): nút "← Quay lại", ảnh
full-width, tên + giá + mô tả, chọn số lượng + ghi chú.
**Rationale:** Rút từ ảnh mobile chủ quán gửi — Lotteria dùng trang riêng có nút Quay lại.
Bảng route trong SPECS phase 08 chưa có route này.
**Quote source:** DISCUSSION-LOG.md#round-3
**UI Components:**
- BackPill, ItemHero, QtyStepper, AddToCartBar

### P08.D-37: CSRF phủ /api/admin/, loại trừ /api/public/
**Category:** technical
**Decision:** `pathRequiresCheck` trả `true` cho `/api/admin/`, **`false` tường minh** cho
`/api/public/`.
**Rationale:** Nếu phủ cả `/api/` thì `curl` không có header `Origin` bị chặn → phá đúng tiêu
chí AC-K1 ("test bằng curl, không chỉ test qua UI").
**Quote source:** DISCUSSION-LOG.md#round-3

### P08.D-38: Nhóm hàng dùng phẳng như schema thật
**Category:** technical
**Decision:** Dải nhóm 1 cấp cuộn ngang. **Sửa SPECS phase 08** bỏ chữ "3 cấp" ở
Dependencies. Việc REQ-A chưa được đáp ứng ghi thành mục riêng, **không kéo vào phase 08**.
**Rationale:** `menu_group` **không có `parent_id`** — nhóm hàng đang 1 cấp, không phải 3 cấp
như REQ-A và tiêu chí phase 02 ghi. Ảnh Lotteria cũng cho thấy nhóm 1 cấp là đủ cho trang khách.
**Quote source:** DISCUSSION-LOG.md#round-3
**UI Components:**
- CategoryRail: dải nhóm hàng cuộn ngang, nền pastel `cat-1..7` theo index

### P08.D-39: Ảnh món theo DB, một ảnh một món
**Category:** technical
**Decision:** `image_url: string | null`, bỏ `images[]` khỏi spec M2 §5.1 và SPECS phase 08.
Đường dẫn tương đối `/uploads/menu/<file>` nên **host `order.<domain>` phải proxy được
`/uploads/`** (đưa vào phase 07), hoặc server trả URL tuyệt đối từ biến môi trường.
**Rationale:** Entity chỉ có **một** cột `image_url varchar(512)`; không có bảng ảnh nào.
Spec ghi `images[]` là sai với data model đang chạy.
**Quote source:** DISCUSSION-LOG.md#round-3

### P08.D-40: GET /menu phải có tầng DTO tường minh
**Category:** technical
**Decision:** Response `{ data: { groups:[{code,name,sort_order,items:[{id,code,name,price,
unit,image_url,is_out_of_stock}]}], bestseller_ids:[], menu_updated_at_ms } }`. Nhóm không
còn món bán được thì bỏ khỏi danh sách. "Bán chạy" **không** là pseudo-group.
**Rationale:** `menu.controller.ts:136` hiện trả `getManyAndCount()` **raw entity** — entity
chính là định dạng đường truyền, kèm cả `is_active`, `created_at`, `updated_at`.
**Quote source:** DISCUSSION-LOG.md#round-3
**Test Scenarios:**
- TS-10: response `GET /orders/:token` không có `status` từng item
  verification_strategy: automated
- TS-35: tập khoá của cả 5 response public khớp allowlist đã commit (đệ quy)
  verification_strategy: automated

### P08.D-41: DTO submit tối thiểu, giữ forbidNonWhitelisted
**Category:** technical
**Decision:** `{client_request_id, fulfillment_type, customer_name, customer_phone,
customer_address?, customer_lat?, customer_lng?, customer_note?, items:[{menu_item_id, qty,
note?}]}`. FE tự giữ tên/giá để hiển thị, **không gửi lên**. Giới hạn độ dài enforce ở DTO:
`note` mỗi dòng ≤255, `customer_note` ≤500, tên ≤128, địa chỉ ≤255.
**Rationale:** `main.ts:81` đặt `forbidNonWhitelisted: true` **toàn cục** — server **không**
âm thầm bỏ qua field lạ, nó trả **400**. Nên cách diễn đạt "backend bỏ qua field giá" ở
P08.D-04 phải hiểu là backend **từ chối**. Giới hạn ở DTO để MySQL không 500 vì overflow.
**Quote source:** DISCUSSION-LOG.md#round-3
**Test Scenarios:**
- TS-11: gửi kèm field `unit_price` trong payload → 400
  verification_strategy: automated

### P08.D-42: map_link do server sinh, không nhận từ client
**Category:** technical
**Decision:** Khách dán link Maps thì server parse lấy toạ độ rồi tự sinh link chuẩn.
**Rationale:** Tránh URL 512 ký tự do khách kiểm soát được render cho nhân viên bấm ở phase 09.
**Quote source:** DISCUSSION-LOG.md#round-3

### P08.D-43: 409 kèm dữ liệu đi qua error.details
**Category:** technical
**Decision:** `ORDER_ALREADY_OPEN_FOR_PHONE` → `details.store_phone`; PATCH 409 →
`details.current_order`. Không thêm field `data` song song.
**Rationale:** Giữ một đường duy nhất; `ErrorEnvelope` và `SuccessEnvelope` là 2 shape rời,
response lỗi không mang được `data`.
**Quote source:** DISCUSSION-LOG.md#round-3

### P08.D-44: Công bố bảng 14 mã lỗi → HTTP status
**Category:** technical
**Decision:** Ghi bảng đầy đủ vào API-CONTRACTS (blueprint sinh).
**Rationale:** `mapStatusToCode` hiện là map **status→code ngược chiều** và hardcode 429 →
`AUTH_RATE_LIMITED`; không công bố bảng thì FE phải đoán.
**Quote source:** DISCUSSION-LOG.md#round-3

### P08.D-45: Thứ tự check cố định, trả hết dòng lỗi một lần
**Category:** technical
**Decision:** blacklist → công tắc nhận đơn → giờ mở cửa → trùng SĐT → trần SL → món còn
bán. Riêng món: `MENU_ITEM_UNAVAILABLE` kèm `details.unavailable_items[] = [{menu_item_id,
name, reason}]` liệt kê **tất cả** dòng lỗi. **Giá đổi không phải lỗi** — nhận đơn theo giá
mới và trả delta.
**Rationale:** NestJS throw một lần, nên thứ tự check không khai báo sẽ âm thầm thành hợp
đồng. Giỏ 30 dòng có 3 món hết hàng mà chỉ báo 1 thì khách phải gửi lại 3 lần.
**Quote source:** DISCUSSION-LOG.md#round-3

### P08.D-46: AppShell + AppHeader 2 biến thể
**Category:** technical
**Decision:** `variant="menu"` (logo + icon giỏ có badge + link "Đơn của tôi") và
`variant="compact"` (logo + `Stepper2`, ẩn CategoryRail). Shell lo `--safe-top`,
`--z-sticky-header`, và cộng `--sticky-cta-h + --safe-bottom` vào `padding-bottom`. Footer có
SĐT quán ở mọi trang. **`OrderHistoryList` mỗi dòng bấm được để mở `/o/:token`**.
**Rationale:** §8-bis yêu cầu header dính mà danh sách component ban đầu không có Header nào.
Không có link từ history sang `/o/:token` thì khách đóng tab là mất đường về trang theo dõi đơn.
**Quote source:** DISCUSSION-LOG.md#round-4
**UI Components:**
- AppShell, AppHeader, OrderHistoryList
**Test Scenarios:**
- TS-36: từ `/history` bấm 1 dòng → mở đúng `/o/:token` của đơn đó
  verification_strategy: automated

### P08.D-47: Lưới món mobile 2 cột
**Category:** technical
**Decision:** Ảnh vuông 1:1, tên món tối đa 2 dòng, giá **18px** (không phải 24px vì cột
hẹp), nút `+` **44px** góc phải dưới. Desktop 4 cột.
**Rationale:** 2 cột thấy ~4 món một màn nên khách cuộn ít hơn, đúng tinh thần G-3 giữ khách
ở lại chọn món.
**Quote source:** DISCUSSION-LOG.md#round-4
**UI Components:**
- MenuGrid, ItemCard, FloatingCart

### P08.D-48: Trang theo dõi đơn không đếm ngược
**Category:** business
**Decision:** Chỉ hiện trạng thái + danh sách món + tổng tiền + nút gọi quán + nút sửa/huỷ.
**Rationale:** Đếm ngược biến hạn 45 phút thành lời hứa và khiến khách ngồi nhìn đồng hồ rồi
huỷ đơn.
**Quote source:** DISCUSSION-LOG.md#round-4

### P08.D-49: OpenHoursEditor cho 2 khung giờ mỗi ngày
**Category:** technical
**Decision:** Ví dụ T2: 07:00–14:00 và 17:00–22:00.
**Rationale:** Quán ăn VN nghỉ trưa rất phổ biến. Schema `open_hours [{dow,from,to}]` đã là
mảng nên không đổi DB. Chỉ 1 khung thì chủ quán phải tắt công tắc tay mỗi ngày — đúng thứ
US-5 muốn tránh.
**Quote source:** DISCUSSION-LOG.md#round-4
**UI Components:**
- OpenHoursEditor: 7 ngày × tối đa 2 khung, chặn `to ≤ from` và 2 khung chồng nhau

### P08.D-50: Font tự host, 3 file woff2
**Category:** technical
**Decision:** Baloo 2 weight **800** + Be Vietnam Pro **400/600**, subset
`latin`+`vietnamese`, ~90–110KB. Không gọi Google Fonts CDN. Không dùng
`system-ui`/`Inter`/`Arial` làm font chính.
**Rationale:** CDN chậm và bị chặn thất thường ở mạng VN. Be Vietnam Pro do nhà chữ Việt làm
nên dấu đặt đúng chỗ ở "ệ", "ỡ". Ngân sách route `/` là 150KB gzip.
**Quote source:** DISCUSSION-LOG.md#round-4

### P08.D-51: Nâng Toast/ConfirmDialog lên packages/ui
**Category:** technical
**Decision:** ⚠️ **ĐÃ BỊ SỬA bởi P08.D-59.** Xem P08.D-59.
**Rationale:** Giữ lại để truy vết.
**Quote source:** DISCUSSION-LOG.md#round-4

### P08.D-52: Câu chữ ở copy/vi.ts, không hiện message của BE
**Category:** technical
**Decision:** `apps/shop/src/copy/vi.ts` gồm map `errorCode → câu tiếng Việt` cho cả 14 mã.
**`message` của BE KHÔNG hiện thẳng cho khách**; FE tự dựng câu, chèn số liệu từ
`error.details`.
**Rationale:** `message` của BE có thể mang chữ kỹ thuật; và 6 trang inline câu chữ sẽ ra 6
kiểu báo lỗi khác nhau.
**Quote source:** DISCUSSION-LOG.md#round-4

### P08.D-53: Trạng thái lúc gửi đơn
**Category:** technical
**Decision:** Nút disable + spinner trong nút + overlay trong suốt chặn bấm. **Xoá giỏ SAU
khi có token**. `navigate('/o/:token', {replace:true})`. Timeout/mất mạng: hiện "Không rõ đơn
đã gửi được chưa — kiểm tra ở Đơn của tôi" + nút sang `/history`, **không cho bấm gửi lại**.
**Rationale:** Trên 3G request mất 3–8 giây. Bấm 2 lần thì lần thứ hai trả 409 khiến khách
tưởng đơn thất bại **dù đơn đầu đã vào**. Dùng `replace` để bấm Back không về `/checkout` với
giỏ đã rỗng.
**Quote source:** DISCUSSION-LOG.md#round-4
**UI Components:**
- SubmitBar: nút gửi dính đáy, có trạng thái đang gửi
**Test Scenarios:**
- TS-37: bấm gửi 2 lần liên tiếp trên mạng chậm → 1 đơn, không hiện lỗi cho khách
  verification_strategy: automated

### P08.D-54: Sửa đơn bằng bottom sheet tại chỗ
**Category:** technical
**Decision:** Mở sheet trên `/o/:token`: chỉ **số lượng + ghi chú**, gọi `PATCH`. **Không**
cho thêm món mới (thêm món thì Huỷ rồi đặt lại). Dùng `--r-sheet`/`--z-sheet`/`--shadow-sheet`.
**Rationale:** Nạp đơn về `/cart` sẽ đụng giỏ hàng hiện tại của khách, phải hỏi ghi đè hay
gộp — thêm một nhánh phức tạp không cần thiết.
**Quote source:** DISCUSSION-LOG.md#round-4

### P08.D-55: Sửa 2 chỗ trong tokens.css
**Category:** technical
**Decision:** (a) tách bậc `--z-floating-cart` và `--z-sticky-cta` (đang **cùng bằng 200**);
(b) đổi chú thích `--r-sheet` từ "bottom sheet chi tiết món" sang "sheet sửa đơn +
ConfirmSheet". Sửa `tokens.css` thì **phải sửa cả** frontmatter `DESIGN.md`.
**Rationale:** Hai z-index bằng nhau thì gặp ở `/cart` không xác định được cái nào trên. Chi
tiết món đã chốt là trang riêng nên chú thích cũ sai.
**Quote source:** DISCUSSION-LOG.md#round-4

### P08.D-56: Tách logic thời gian ra hàm nhận now
**Category:** technical
**Decision:** `isStoreOpenNow(now)`, `isOrderExpired(order, now)`. Kèm 1 test API `UPDATE`
trực tiếp `expires_at` về quá khứ.
**Rationale:** Chạy trong milliseconds, không cần đợi, không sửa đồng hồ hệ thống. Không dùng
fake timers vì `@nestjs/schedule @Cron` đọc đồng hồ hệ thống.
**Quote source:** DISCUSSION-LOG.md#round-5
**Constraints:** Test `UPDATE expires_at` tuyệt đối không được chạy vào DB production.

### P08.D-57: TS-09 đo bằng API đọc số liệu trước/sau
**Category:** technical
**Decision:** Gọi `/orders/stats` + `/tables` + `/orders` (bếp) + `/history` TRƯỚC khi tạo 5
đơn WAITING, tạo, gọi lại, assert **từng con số y nguyên**.
**Rationale:** Đo đúng cái người dùng thấy, không phụ thuộc chi tiết SQL. Đây là rủi ro
**Cao** nhất trong bảng §10 của spec M2.
**Quote source:** DISCUSSION-LOG.md#round-5
**Test Scenarios:**
- TS-09: 5 đơn WAITING → doanh thu / sơ đồ bàn / bếp / history không đổi
  verification_strategy: fixture

### P08.D-58: impeccable chặn ở mức error, bundle chỉ cảnh báo
**Category:** technical
**Decision:** `impeccable detect` verdict `error` → BLOCK. Ngân sách 150KB → WARN.
**Rationale:** 3 file font ~110KB đã chiếm gần hết ngân sách; vượt vì lý do hợp lý thì không
nên chặn ship. Còn lỗi lệch design system thì phải chặn, kẻo DESIGN.md viết kỹ mà không có
gate nào.
**Quote source:** DISCUSSION-LOG.md#round-5
**Test Scenarios:**
- TS-24: `npx impeccable detect apps/shop/src` → 0 lỗi mức error
  verification_strategy: automated
- TS-23: bundle route `/` ≤ 150KB gzip, TTI < 3s Slow-4G
  verification_strategy: automated

### P08.D-59: apps/shop tự viết Toast/ConfirmDialog, không sửa apps/web
**Category:** technical
**Decision:** **Sửa P08.D-51.** Không nâng lên `packages/ui`, **không sửa file nào của
`apps/web`**. Chỉ còn **`packages/utils`** là package mới (không phải 2).
**Rationale:** Nâng lên sẽ sửa **17 file** của app đang bán hàng trong khi repo có **0 test**
— không có lưới an toàn nào bắt hồi quy. Và 2 app có design system khác nhau hoàn toàn
(`apps/shop` dùng `tokens.css`, `apps/web` hardcode 57 màu hex, `styles.css` có 0 CSS
variable) nên dùng chung vẫn phải style lại từ đầu. Cũng đúng với Out of Scope của SPECS.
**Quote source:** DISCUSSION-LOG.md#round-5

### P08.D-60: Ba test tập trung vào 4 điểm dùng chung
**Category:** technical
**Decision:** (1) **bảng định tuyến ở chế độ production** — `(Host, path, Accept)` → loại nội
dung mong đợi; (2) **snapshot đóng băng error envelope** cho 401/403/404/409/422/429 từ
endpoint POS hiện có; (3) **ma trận CSRF** gồm origin giả mạo. Cộng checklist tay cho các màn
POS chính. Không cố viết E2E cho cả POS.
**Rationale:** Repo có 0 test và phase 08 sửa 4 single-point-of-failure mà mọi màn nội bộ
chạy qua.
**Quote source:** DISCUSSION-LOG.md#round-5
**Test Scenarios:**
- TS-08: công tắc OFF, gọi `POST /orders` bằng curl → 409 ONLINE_ORDERING_DISABLED
  verification_strategy: automated
- TS-38: `/api/public/menu` với `Accept: text/html` vẫn trả JSON, không trả vỏ HTML
  verification_strategy: automated

### P08.D-61: Rate limit sau proxy — 4 cách kiểm
**Category:** technical
**Decision:** (a) 2 client `X-Forwarded-For` khác nhau — A hết quota 429, B ngay sau phải
200; (b) chuỗi giả mạo `1.2.3.4, <ip thật>` không reset được bộ đếm; (c) load probe 10 client
poll 2 giây trong 60 giây → POS **không** có 429 nào; (d) kiểm tay trên VPS thật sau Caddy thật.
**Rationale:** `app.set('trust proxy', 1)` (main.ts:26) — nếu số hop sai thì key throttle
thành IP của Caddy, và 60 req/phút biến thành giới hạn cho **toàn bộ khách cùng lúc**: giờ cao
điểm web trông như sập. **Test một client duy nhất pass y hệt trong cả trường hợp đúng và sai.**
**Quote source:** DISCUSSION-LOG.md#round-5

### P08.D-62: Ma trận chuyển trạng thái của open_phone_lock
**Category:** technical
**Decision:** Sau mỗi chuyển (WAITING→CANCELLED / REJECTED / EXPIRED / CONFIRMED, và PATCH
khi WAITING) assert `open_phone_lock IS NULL` ở trạng thái cuối, non-NULL chỉ khi WAITING, rồi
assert cùng SĐT gửi được đơn mới ngay. **Invariant thường trực**: query
`open_phone_lock IS NOT NULL AND status <> 'WAITING'` phải trả 0. Một normalizer duy nhất dùng
cho cả blacklist lẫn cột lock.
**Rationale:** Cột UNIQUE phải xoá ở **mọi** đường ra, nếu không sẽ giam khách sau 409 vĩnh
viễn. Nếu lock lưu chuỗi thô thì máy B gõ `+84912...` lách qua luật mà máy A đặt bằng `0912...`.
**Quote source:** DISCUSSION-LOG.md#round-5

### P08.D-63: Deploy lần đầu phải thử trên bản sao prod
**Category:** technical
**Decision:** Restore dump có số dòng thật, boot build mới, assert không mất dòng nào / không
drop cột nào / index mới tồn tại, và **ghi lại thời gian boot** để biết cửa sổ ALTER dài bao
lâu. Kèm **boot 2 lần liên tiếp** kiểm `store_settings`.
**Rationale:** `synchronize: true` sẽ ALTER bảng `orders`/`order_items` đang có doanh thu
thật, trong giờ quán mở cửa. Backup đang là weekly theo F-14 nên hỏng là mất thật.
**Quote source:** DISCUSSION-LOG.md#round-5

### P08.D-64: Đối chiếu giỏ cũ khi giá đổi
**Category:** technical
**Decision:** Thêm kịch bản cho `is_active` bật false và dòng đã bị xoá cứng — cả hai trả về
trong `details.unavailable_items` cùng shape, không 500, không dòng ma, không giá NULL. Và
**toàn bộ giỏ không còn món nào bán được** → trả danh sách + tạo **0 dòng** trong
`online_order_requests`.
**Rationale:** TS-15 chỉ phủ `is_out_of_stock`. Không được tạo đơn WAITING rỗng và không được
tiêu tốn khoá SĐT.
**Quote source:** DISCUSSION-LOG.md#round-5

### P08.D-65: Assertion allowlist dương cho response public
**Category:** technical
**Decision:** So **tập khoá chính xác** của cả 5 response public với danh sách đã commit, đệ
quy.
**Rationale:** Cột nào thêm vào `menu_items` hay `online_order_requests` sau này (ghi chú từ
chối của admin, IP khách, user_agent) sẽ **mặc định làm test fail** thay vì âm thầm lọt ra
endpoint công khai.
**Quote source:** DISCUSSION-LOG.md#round-5

### P08.D-66: Luật 1 đơn mở kiểm bằng query có expires_at
**Category:** technical
**Decision:** **Sửa P08.D-07 / P08.D-23 / P08.D-26.** Luật "1 SĐT 1 đơn mở" kiểm bằng
`WHERE status='WAITING' AND expires_at > NOW()` — hết hạn là tự động không còn tính,
**không chờ cron**. Cột `open_phone_lock` UNIQUE chỉ còn **một** việc: chặn 2 request **song
song**. Cron 5 phút vẫn ghi `EXPIRED` + xoá lock để dọn rác.
**Rationale:** P08.D-07 hứa "nhả khoá SĐT **ngay**" nhưng hết hạn tính khi đọc + lock chỉ do
cron xoá → phút 45–50 trang khách hiện "đã hết hạn" mà UNIQUE index vẫn giữ khoá, khách đặt
lại **vẫn bị 409**. Hai quyết định nói ngược nhau.
**Quote source:** DISCUSSION-LOG.md#deep-probe-1

### P08.D-67: ETag của menu gộp dấu thời của cache bán chạy
**Category:** technical
**Decision:** **Sửa P08.D-34.** ETag = `hash(MAX(updated_at) menu + bestseller_generated_at)`.
**Rationale:** ETag chỉ tính từ `MAX(updated_at)` thì bảng "Bán chạy" làm mới mỗi 30 phút
**không đổi ETag** → khách nhận `304` và không bao giờ thấy bảng mới cho tới khi ai đó sửa
một món.
**Quote source:** DISCUSSION-LOG.md#deep-probe-2
**Test Scenarios:**
- TS-39: bếp bật hết hàng → `GET /menu` phản ánh trong TTL; bảng bán chạy làm mới → ETag đổi
  verification_strategy: automated

### P08.D-68: Hạn hết hiệu lực = min(gửi + 45 phút, giờ đóng cửa)
**Category:** business
**Decision:** Đơn 21:29 (quán đóng 22:00) hết hạn lúc **22:00** thay vì 22:14. Màn hình gửi
thành công ghi rõ "quán đóng cửa 22:00, sẽ gọi lại trước đó".
**Rationale:** Với 45 phút cứng, mọi đơn trong 30 phút cuối đều hết hạn **sau** khi quán đã
đóng — không còn ai duyệt, khách chờ vô vọng qua đêm.
**Quote source:** DISCUSSION-LOG.md#deep-probe-3

### P08.D-69: DataSource public không sync schema
**Category:** technical
**Decision:** `synchronize: false`, `entities` trỏ **cùng** mảng với DataSource chính. Nó chỉ
là pool kết nối thứ hai. Chỉ DataSource chính được sync schema.
**Rationale:** TypeORM sync theo mảng `entities` của **từng** DataSource — hai cái cùng
`synchronize: true` sẽ tranh nhau lúc boot.
**Quote source:** DISCUSSION-LOG.md#deep-probe-4

### P08.D-70: Nút xoá thông tin xoá cả trong DB
**Category:** technical
**Decision:** Gọi API kèm `X-Customer-Token` → server **ẩn danh hoá ngay** các đơn đã ở trạng
thái cuối (`EXPIRED`/`REJECTED`/`CANCELLED_BY_CUSTOMER`/`CONFIRMED` đã thanh toán) của
**chính** `customer_token` đó — null tên/SĐT/địa chỉ, giữ `subtotal` + `items_snapshot` cho
phase 10. Đơn **đang WAITING thì KHÔNG xoá** và **nói rõ điều đó trên màn hình**.
**Rationale:** P08.D-15 chỉ xoá `localStorage` trong khi §8-bis hứa với khách "Thông tin của
bạn chỉ dùng để giao đơn này" mà DB giữ 90 ngày. Khách bấm nút, tưởng đã xoá, thực tế chưa.
Xoá cả đơn WAITING thì quán mất tên + SĐT nên không gọi được cho ai.
**Quote source:** DISCUSSION-LOG.md#deep-probe-5
**Endpoints:**
- POST /api/public/session/forget (auth: none + X-Customer-Token, purpose: ẩn danh hoá đơn đã kết thúc của thiết bị)
**Test Scenarios:**
- TS-40: bấm xoá → đơn đã kết thúc mất PII, đơn WAITING giữ nguyên + có thông báo
  verification_strategy: automated

### P08.D-71: Báo ngay từ MenuPage khi thiết bị đang có đơn mở
**Category:** technical
**Decision:** Đọc `/orders` theo `X-Customer-Token` → banner dính "Bạn đang có 1 đơn chờ quán
xác nhận" + nút "Xem đơn". `FloatingCart` vẫn cho thêm món nhưng **nút checkout đổi thành
"Xem đơn đang chờ"**.
**Rationale:** Khách gửi đơn xong quay lại thêm món sẽ bị `409` ở bước cuối — chọn xong 5 món
mới biết không gửi được là điểm rơi tệ nhất.
**Quote source:** DISCUSSION-LOG.md#deep-probe-6
**UI Components:**
- StoreBanner: dùng cho cả banner tạm ngưng, ngoài giờ, và "đang có đơn chờ"

### P08.D-72: Không deploy
**Category:** business
**Decision:** Tuyệt đối không chạy `./deploy.sh`, không push lên `main`, không chạm server
production. Sửa code local trên nhánh `feat/online-ordering`; test ở local. Chỉ deploy khi chủ
quán duyệt tường minh.
**Rationale:** Chỉ thị trực tiếp của chủ quán 2026-07-29.
**Quote source:** DISCUSSION-LOG.md#deep-probe-6
**Constraints:** `preferred_env_for` = local cho cả review/test/roam/accept.

### P08.D-73: Index trên 3 bảng mới
**Category:** technical
**Decision:** `online_order_requests`: **UNIQUE(`order_token`)**, INDEX(`customer_phone`),
INDEX(`created_at`), INDEX(`expires_at`), UNIQUE(`open_phone_lock`), UNIQUE(`client_request_id`,
`customer_token`), INDEX(`status`, `submitted_at`). `phone_blacklist`: PK(`phone`),
INDEX(`expires_at`). `store_settings`: PK(`key`).
**Rationale:** Thiếu UNIQUE trên `order_token` thì M2.D-11 ("token không đoán được") không
được enforce ở tầng DB, và mọi lần poll trang tracking phải quét toàn bảng. `customer_phone`
không có index làm chậm luật 1 đơn mở + kiểm blacklist ở **mỗi** lần submit. Đây là gap CrossAI
yêu cầu biến thành quyết định.
**Quote source:** DISCUSSION-LOG.md#crossai-review
**Test Scenarios:**
- TS-45: insert 2 dòng cùng `order_token` → DB từ chối bằng UNIQUE, không phải bằng code
  verification_strategy: automated

### P08.D-74: Sinh token bằng crypto.randomBytes, lưu plaintext
**Category:** technical
**Decision:** `crypto.randomBytes(32).toString('hex')` (64 ký tự hex) cho **cả**
`customer_token` và `order_token` — không dùng dep `uuid` (UUIDv4 chỉ 122 bit entropy và có
dạng nhận biết được). Lưu **plaintext** trong DB: chấp nhận có ý thức vì server phải tra được
token từ URL mà không có bước auth nào. **HTTPS là lớp bảo vệ duy nhất trên đường truyền.**
Token **không được log** ở bất kỳ đâu — không vào `docker logs`, không vào audit log, không
vào message lỗi.
**Rationale:** CrossAI chỉ ra tiêu chí M2.D-11 yêu cầu "2 đơn liên tiếp có token khác nhau
hoàn toàn" mà không quyết định nào chỉ định nguồn entropy. 32 byte = 256 bit, không đoán được
trong thực tế.
**Quote source:** DISCUSSION-LOG.md#crossai-review
**Constraints:** Đi cùng P08.D-34 (token rời khỏi query string) — nếu token vào URL query thì
Caddy ghi nguyên URI vào log, phá luật "không log token".
**Test Scenarios:**
- TS-46: 2 đơn liên tiếp có token dài 64 hex, khác nhau hoàn toàn; grep token trong log = 0 kết quả
  verification_strategy: automated

### P08.D-75: Bảng kiểm kê đầy đủ 24 setting key
**Category:** technical
**Decision:** `store_settings` có **24 key** (không phải 20 như SPECS ghi) — 20 key gốc §4.1
spec M2 + 4 key phát sinh từ thảo luận: `last_order_before_close_min` (int, 30),
`max_delivery_km` (int, 15), `min_delivery_amount` (int, 100000), `large_order_amount` (int,
1000000). **TS-32 assert đúng 24**, không cứng 20.
**Rationale:** SPECS ghi "20 key seed" nhưng không liệt kê đủ 20; 4 key mới đẩy tổng lên 24.
Không có bảng kiểm kê thì lần sau thêm key lại lệch, và `OnModuleInit` upsert có thể thiếu key
mà không ai biết.
**Quote source:** DISCUSSION-LOG.md#crossai-review
**Test Scenarios:**
- TS-32: boot 2 lần → đúng **24** key, giá trị chủ quán sửa không bị ghi đè, công tắc OFF ở lần seed đầu
  verification_strategy: automated

### P08.D-76: Bốn kịch bản test cho endpoint chưa được phủ
**Category:** technical
**Decision:** Thêm TS-41..TS-44 cho 5 endpoint CrossAI phát hiện **không có kịch bản nào**.
**Rationale:** Check A của STEP 5 chỉ kiểm ở **cấp quyết định** ("quyết định nào có mục
`Endpoints:` thì có `TS-NN` nào không") nên P08.D-30 liệt kê 13 endpoint mà chỉ cần 1 test là
PASS. Lỗ này của harness để CrossAI bắt được.
**Quote source:** DISCUSSION-LOG.md#crossai-review
**Endpoints:**
- POST /api/public/session (auth: none, purpose: sinh/nhận customer_token)
- DELETE /api/public/orders/:order_token (auth: none + token, purpose: khách tự huỷ)
- GET /api/admin/phone-blacklist (auth: admin, purpose: liệt kê)
- POST /api/admin/phone-blacklist (auth: admin, purpose: thêm SĐT)
- DELETE /api/admin/phone-blacklist (auth: admin, purpose: xoá SĐT)
**Test Scenarios:**
- TS-41: `POST /session` — chưa có token thì sinh mới; đã có `X-Customer-Token` thì trả lại chính token đó
  verification_strategy: automated
- TS-42: `DELETE /orders/:token` khi WAITING → status `CANCELLED_BY_CUSTOMER` và `open_phone_lock` về NULL, SĐT đặt lại được ngay
  verification_strategy: automated
- TS-43: blacklist CRUD đầy đủ — thêm → liệt kê thấy → xoá → liệt kê không còn; role `order` gọi thì 403
  verification_strategy: automated
- TS-44: `PATCH /orders/:token` happy path — trả **đơn đầy đủ** đúng shape GET, kèm delta giá nếu có
  verification_strategy: automated

## Acknowledged tradeoffs

- **Đồ có cồn bán không kiểm tuổi** (P08.D-14) — trang công khai không login nên không có bước
  xác thực tuổi nào. Chủ quán chọn có ý thức.
- **Không dùng UPDATE có điều kiện khi đổi trạng thái** — còn race giữa cron ghi `EXPIRED` và
  khách `PATCH` ở phút 44:59, và với admin duyệt ở phase 09. Chủ quán chọn không sửa.
- **Máy dùng chung trong nhà** (P08.D-15) — `customer_token` là của máy không phải của người;
  giữ giới hạn gốc M2.D-10, chỉ giảm thiểu bằng 3 biện pháp UI.
- **60 req/phút/IP có thể chặn oan khách sau CGNAT** — giảm thiểu bằng P08.D-29 (429 luôn có
  nút gọi quán).
- **Trùng lặp `Toast`/`ConfirmDialog` giữa 2 app** (P08.D-59) — chấp nhận để không sửa 17 file
  của app đang bán hàng khi repo có 0 test.

## Acknowledged gaps

- **`ip_hash` chưa có biến môi trường salt** — SHA-256 IPv4 không salt là đảo ngược được;
  IPv6 cần luật cắt prefix. Caddyfile dùng `header_up X-Forwarded-For {remote_host}` **thay
  thế** header nên `req.ip` hiện an toàn khỏi spoof — ghi lại kẻo ai đó "sửa" thành append.
- **`ALLOWED_ORIGIN` thiếu trong `.env.production.example`** (fallback `http://localhost:5173`);
  chưa có entry cho salt IP-hash và origin của shop.
- **`nestjs-pino` có trong dependency nhưng `app.useLogger` chưa bao giờ được gọi**; TypeORM
  `logging: false` ở prod; Docker chưa cấu hình `max-size`/`max-file` → `docker logs` phình
  vô hạn.
- **`--r-sheet`/`--z-sheet`/`--shadow-sheet`** chỉ được dùng bởi sheet sửa đơn và ConfirmSheet
  sau P08.D-54; nếu không dùng thì nên xoá khỏi token.

## Open questions

- **Màu thương hiệu chưa chốt** (M2.D-71) — logo hiện có là ảnh chân dung, màu chủ đạo
  `#895852`/`#BC7D85` độ rực S≈0.34–0.43 nên không dùng làm màu nhấn được. Đang tạm dùng đỏ
  coral `#e4453a` của Lotteria. Cần logo dạng nhãn hiệu.
- **Thiếu ảnh design ref của lưới món trên mobile** — chưa biết Lotteria xếp 1 hay 2 cột ở
  trang menu; P08.D-47 chọn 2 cột theo suy luận, chưa có ảnh xác nhận.
- **REQ-A "nhóm hàng 3 cấp" chưa được đáp ứng** — `menu_group` không có `parent_id`. Cần quyết
  riêng: sửa REQ-A cho khớp thực tế, hay mở phase mới. **Không thuộc phase 08.**
- **Hai cron của Milestone 1 chưa bao giờ chạy trên production** — retention 90 ngày của audit
  log (REQ-G) chưa được thực thi. P08.D-21 sẽ sửa, nhưng việc audit log đã phình bao nhiêu thì
  chưa biết.
- **Repo có 0 file test** trong khi `apps/api/package.json:11` có `"test": "vitest run"`. Cần
  dựng hạ tầng test từ 0: `vitest.config`, `.env.test`, fixture, và chốt cứng rằng test
  `UPDATE expires_at` không bao giờ chạy vào DB production.
- **FOUNDATION §9.1 còn ghi `deploy.api: rsync + pm2 reload`** — thực tế đang Docker Compose.

### Ba finding mức minor của CrossAI (log lại, chưa xử lý)

- **`images[]` chưa được sửa trong SPECS.md** — P08.D-39 tuyên bố bỏ `images[]` nhưng SPECS
  hiện tại vẫn ghi `images[]` ở In Scope và AC-I1/AC-I4. Developer đọc SPECS sẽ implement mảng,
  đọc CONTEXT sẽ implement scalar. **Sẽ sửa cùng amendment của P08.D-70.**
- **`CONFIRMED` có trong union nhưng không có test path ở phase 08** — P08.D-31 khai nhánh
  `CONFIRMED` mà phase 08 chưa bao giờ ghi trạng thái đó (phase 09 mới ghi). Cần chốt: thêm TS
  kiểm shape, hay ghi rõ FE phase 08 fallback "trạng thái không xác định".
- **Màu thương hiệu + ảnh design mobile vẫn là open question** — P08.D-47 chọn 2 cột theo suy
  luận, chưa có ảnh xác nhận. CrossAI đề nghị ghi rõ `#e4453a` và 2-cột là **placeholder có thể
  refactor sau design review**, chứ không coi là đã chốt.

## Risks

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Đơn WAITING lọt vào doanh thu / bếp / sơ đồ bàn | **Cao** | Bảng staging riêng (M2.D-01) loại rủi ro về mặt cấu trúc; TS-09 đo bằng API trước/sau (P08.D-57) |
| `synchronize: true` ALTER bảng doanh thu thật lúc boot, backup weekly | **Cao** | P08.D-63 thử trên bản sao prod, đo cửa sổ ALTER; P08.D-72 không deploy tới khi chủ quán duyệt |
| `/api/public/*` trả HTML thay vì JSON trên production | **Cao** | Sửa `main.ts` ở phase 07 + TS-38 assert `Accept: text/html` vẫn ra JSON |
| Rate limit đếm sai IP sau proxy → chặn toàn bộ khách | **Cao** | P08.D-61 bốn cách kiểm, trong đó 2 client khác `X-Forwarded-For` là bắt buộc |
| Token đơn/thiết bị rò qua log Caddy hoặc Referer | Trung bình | P08.D-34 chuyển sang header + `no-store` cho `/orders*`; `Referrer-Policy: no-referrer` ở phase 07 |
| Sửa 4 điểm dùng chung làm hồi quy POS mà không ai biết | Trung bình | P08.D-60 ba test tập trung + checklist tay; repo có 0 test nên đây là lưới duy nhất |
| Cache menu đóng băng cờ hết hàng | Trung bình | P08.D-34 hai mức TTL + P08.D-67 ETag gộp; lọc bestseller lúc trả về |
| Khách bị giam sau 409 vì lock không được xoá | Trung bình | P08.D-66 kiểm bằng query có `expires_at`; P08.D-62 ma trận chuyển trạng thái + invariant thường trực |
| Cột UNIQUE + generated column làm API không boot được | Trung bình | P08.D-26 dùng cột thường do service ghi, không dùng generated column |
| Ngân sách 150KB gzip bị font chiếm gần hết | Thấp | P08.D-50 chỉ 3 file woff2 subset; P08.D-58 ngân sách chỉ cảnh báo không chặn |

## Summary

- Total decisions: **76** (trong đó 4 là bản sửa cho quyết định trước: P08.D-32→P08.D-10, P08.D-59→P08.D-51,
  P08.D-66→P08.D-07/P08.D-23/P08.D-26, P08.D-67→P08.D-34)
- Endpoints noted: **14** (đã phủ test đủ sau CrossAI) (11 public + 3 nhóm admin)
- UI components noted: **26**
- Test scenarios noted: **46** (TS-01..TS-46)
- Rounds: 5 + Deep Probe ×6 = **11 lượt tương tác**
- Challenger: 3 lần (hết loop guard `adversarial_max_rounds: 3`) — cả 3 verdict **FLAWED**
- Expander: 5 lần (5/6) — tổng **25 CRITICAL_MISSING** đã xử lý
- CrossAI (Claude Sonnet, 1/1 CLI): verdict **flag**, coverage 87%, score 6/10 — 5 major đã
  Address (→ P08.D-73..76 + amendment SPECS), 3 minor log lại ở Open questions

## Deferred Ideas

- **Web Push (VAPID) / Telegram / Zalo ZNS** — hoãn qua adapter M2.D-37 (phase 09+).
- **Gộp `Toast`/`ConfirmDialog` vào `packages/ui`** — sau khi có test bao phủ `apps/web`.
- **Dọn 57 màu hex hardcode trong `apps/web`** — không đổi được màu thương hiệu ở một chỗ;
  nợ của `apps/web`, ngoài scope phase 08.
- **Xoá cứng `online_order_requests`** (thay vì chỉ ẩn danh hoá) — quyết ở phase 10 với chân
  trời dài hơn, ví dụ 2 năm.
- **Đo khoảng cách chính xác bằng OSRM self-host** — nếu Haversine × 1.3 sai quá nhiều.
- **Đặt trước theo giờ** (đặt cỗ, hẹn giờ giao) — phase 08 không có; khách phải gọi quán.
