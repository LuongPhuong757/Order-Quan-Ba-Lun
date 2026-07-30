# Phase 8: Menu công khai, Checkout & Công tắc nhận đơn - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-30
**Phase:** 8-Menu công khai, Checkout & Công tắc nhận đơn
**Areas discussed:** Lớp dữ liệu apps/shop, Giỏ hàng, Ảnh món, UI admin, Xác nhận giả định UI-SPEC, Cơ chế công tắc & anti-abuse

**Vùng bị loại khỏi danh sách hỏi (Claude quyết theo philosophy "technical implementation details"):** tên bảng/cột, hình dạng DTO, cách chia plan, cách hash IP, thư viện resize cụ thể.

---

## Lớp dữ liệu apps/shop

### HTTP client

| Option | Description | Selected |
|--------|-------------|----------|
| fetch thuần + hook tự viết | 0 dependency mới, đúng triết lý tự-host đã áp cho font. Bundle nhỏ cho khách 3G. Đánh đổi: tự lo retry/cache | ✓ |
| axios (khớp apps/web) | Cùng pattern interceptor với admin. Đánh đổi: +~13 kB gzip mà shop không cần interceptor auth nào | |
| TanStack Query | Cache/retry/refetch tự động. Đánh đổi: +~13 kB, khái niệm mới, và phase 9 đã chọn SSE chứ không poll | |

**User's choice:** fetch thuần + hook tự viết
**Notes:** Bundle size của trang khách là tiêu chí thắng — khách vào bằng 3G.

### Validate response bằng zod

| Option | Description | Selected |
|--------|-------------|----------|
| Có — zod parse mọi response | `synchronize: true` không migration (C-SCHEMA-07) → field đổi âm thầm là rủi ro thật. zod báo lỗi tại chỗ thay vì undefined lan xuống render | ✓ |
| Không — tin type TypeScript | Ít code, bundle nhỏ hơn ~12 kB. Đánh đổi: type bị xoá lúc chạy, BE thiếu field → màn trắng | |

**User's choice:** Có — zod parse mọi response
**Notes:** Phát hiện lúc scout: `apps/shop` chưa có `zod` là direct dependency (chỉ có `@order/schemas`) → phải thêm.

### Tải menu & tìm kiếm

| Option | Description | Selected |
|--------|-------------|----------|
| Tải 1 lần toàn bộ, lọc + tìm client-side | Menu 1 quán lẩu chỉ vài chục món. Đổi tab và gõ tìm phản hồi tức thì, không spinner, không debounce server | ✓ |
| Gọi API theo nhóm / theo từ khóa | Chỉ tải thứ đang xem. Đánh đổi: mỗi lần đổi tab là 1 request + spinner trên 3G | |

**User's choice:** Tải 1 lần toàn bộ, lọc + tìm client-side
**Notes:** Hệ quả: ô tìm kiếm của REQ-I không cần endpoint search phía BE.

### Lỗi mạng khi tải menu

| Option | Description | Selected |
|--------|-------------|----------|
| Banner lỗi tại chỗ + nút "Thử lại" | Giữ header/wordmark, chỉ vùng lưới món thành banner. Khách 3G hay chập mạng | ✓ |
| Màn lỗi toàn trang | 1 error boundary cho cả app. Đánh đổi: mất header/logo, cảm giác "web sập" | |
| Tự retry ngầm 2-3 lần rồi mới báo | Che được chập mạng ngắn. Đánh đổi: mạng chết thật thì khách đợi lâu, tưởng treo | |

**User's choice:** Banner lỗi tại chỗ + nút "Thử lại"

---

## Giỏ hàng

### Lưu ở đâu

| Option | Description | Selected |
|--------|-------------|----------|
| localStorage | Có cuộc gọi đến, tắt máy — quay lại giỏ vẫn nguyên. Đúng G-3. Cùng chỗ đã lưu `customer_token` | ✓ |
| sessionStorage | Sạch hơn, không bao giờ có giỏ "cũ 3 ngày". Đánh đổi: thoát app xem tin nhắn rồi vào lại có thể mất giỏ | |
| Chỉ state trong RAM | Ít code nhất. Đánh đổi: tệ nhất cho mobile — chuyển app qua lại là trình duyệt có thể reload | |

**User's choice:** localStorage

### Món hết hàng / giá đổi khi khách quay lại

| Option | Description | Selected |
|--------|-------------|----------|
| Tự đồng bộ theo menu mới + báo rõ | Giá đổi → cập nhật + banner; hết hàng → làm mờ + khóa, không tính vào tổng, chặn TIẾP TỤC tới khi khách xoá. Khách không bất ngờ ở bước cuối | ✓ |
| Tự xoá món hết hàng, im lặng cập nhật giá | Ít UI hơn. Đánh đổi: khách từng vì món biến mất không lý do, hoặc tổng tiền nhảy — dễ thành khiếu nại | |
| Không đối chiếu, để BE chặn lúc submit | Ít code nhất, BE đã có `MENU_ITEM_UNAVAILABLE` + snapshot giá. Đánh đổi: khách điền hết thông tin mới bị báo lỗi — điểm rụng khách cao nhất | |

**User's choice:** Tự đồng bộ theo menu mới + báo rõ

### Hạn sống của giỏ

| Option | Description | Selected |
|--------|-------------|----------|
| Hết hạn sau 24 giờ | Quán lẩu đặt theo bữa — giỏ 3 ngày trước không còn ý nghĩa. Không phải đối chiếu giá dữ liệu quá cũ | ✓ |
| Không hết hạn | Giỏ sống mãi. Đánh đổi: khách quay lại sau 2 tuần thấy giỏ lạ | |
| Hết hạn cuối ngày (00:00) | Khớp nhịp "đến hết hôm nay" của công tắc. Đánh đổi: chọn món lúc 23:50 thì 10 phút sau mất giỏ | |

**User's choice:** Hết hạn sau 24 giờ

### Đa tab

| Option | Description | Selected |
|--------|-------------|----------|
| Mặc kệ — tab nào ghi sau thắng | Khách mobile gần như không mở 2 tab menu. Không viết code sync, không test thêm | ✓ |
| Sync qua storage event | 2 tab luôn thấy cùng 1 giỏ, ~15 dòng code. Đánh đổi: thêm 1 đường dữ liệu phải test cho tình huống gần như không xảy ra | |

**User's choice:** Mặc kệ — tab nào ghi sau thắng

---

## Ảnh món

> **Phát hiện lúc scout:** spec M2.D-43 ghi public menu trả `images[]` nhưng `menu_item` chỉ có `image_url` (varchar 512, nullable). Ảnh upload qua multer vào `uploads/menu/`, serve tại `/uploads/menu/...`. **Không có bước resize/thumbnail nào trong repo.**

### images[] vs image_url

| Option | Description | Selected |
|--------|-------------|----------|
| Map thành mảng 0..1 phần tử | Không đổi schema, không đổi UI admin. Giữ hợp đồng API của spec nên sau muốn nhiều ảnh thì FE không phải sửa | ✓ |
| Phase 8 làm nhiều ảnh thật | Thêm bảng `menu_item_images` + sửa UI upload. Đánh đổi: năng lực mới, không có trong REQ-I, UI-SPEC chỉ vẽ 1 ảnh | |
| Đổi spec thành image_url | Thẳng thắn nhất. Đánh đổi: sau thêm ảnh thứ 2 là breaking change cho FE | |

**User's choice:** Map thành mảng 0..1 phần tử
**Notes:** Ghi vào `OVERRIDE-DEBT.md` như một entry mới.

### Món không có ảnh

| Option | Description | Selected |
|--------|-------------|----------|
| Placeholder nền gỗ + tên món | Khối `--wood-100` đúng aspect-ratio, tên món `--wood-700` + icon bát. Lưới không so le, trông có chủ ý | ✓ |
| Ẩn hẳn vùng ảnh | Card chỉ có chữ. Đánh đổi: lưới so le trông như lỗi, món không ảnh bị nhìn như kém quan trọng | |
| 1 ảnh mặc định dùng chung | 1 file cho mọi món thiếu ảnh. Đánh đổi: nhiều món cùng 1 ảnh trông như lỗi dữ liệu, tệ hơn placeholder thật thà | |

**User's choice:** Placeholder nền gỗ + tên món

### Tỷ lệ ảnh

| Option | Description | Selected |
|--------|-------------|----------|
| Cắt đầy khung (object-fit: cover) | Lấp kín khung 4:3, lưới cực đều. Đánh đổi: ảnh dọc bị cắt trên dưới — ổn với ảnh món ăn vì chủ thể ở giữa | ✓ |
| Thấy trọn ảnh (object-fit: contain) | Không cắt gì. Đánh đổi: ảnh dọc để lại 2 dải trống — lưới trông rọc rách | |

**User's choice:** Cắt đầy khung (object-fit: cover)

### Ảnh nặng 3-5 MB trên 3G

| Option | Description | Selected |
|--------|-------------|----------|
| Thêm resize lúc upload | sharp resize ~800px + webp khi admin upload. 4 MB → ~80 kB. Quyết định trận menu có tải được trên 3G hay không. Đánh đổi: +1 dependency native, +1 việc vào phase 8 | ✓ |
| Chỉ lazy-load + width/height | Scope phase 8 nhỏ nhất. Đánh đổi: khách 3G vẫn tải ảnh MB — màn menu có thể mất 10-30s | |
| Giới hạn dung lượng khi upload | Chặn file >500 kB. Đánh đổi: đẩy việc sang chủ quán → thực tế sẽ dẫn tới món không có ảnh | |

**User's choice:** Thêm resize lúc upload
**Notes:** ⚠ Đây là **scope thêm** so với REQ-I..L, chủ dự án chủ động duyệt. Planner cần cân nhắc ảnh hưởng của dependency native tới Docker image (máy dev không có Docker — `07-UAT.md` test 6).

---

## UI admin (apps/web)

> **Phát hiện lúc scout:** `apps/web` chưa có trang settings. `/admin/users` và `/admin/audit` đã tồn tại dưới `RoleGate allow={['admin']}` → `/admin/settings` khớp pattern.

### Vị trí công tắc ON/OFF

| Option | Description | Selected |
|--------|-------------|----------|
| Widget ở Dashboard + chi tiết ở /admin/settings | Tắt được trong 1 chạm khi đang bận. Chọn kiểu OFF, lý do, giờ mở cửa ở settings | ✓ |
| Chỉ ở /admin/settings | Tất cả cài đặt 1 chỗ. Đánh đổi: muốn tắt nhanh phải điều hướng 2-3 bước — đúng lúc đang bận nhất | |
| Chỉ widget ở Dashboard | 1 chỗ duy nhất. Đánh đổi: giờ mở cửa 7 thứ + free_ship_km + blacklist không có chỗ đặt hợp lý | |

**User's choice:** Widget ở Dashboard + chi tiết ở /admin/settings
**Notes:** Tình huống thật là hết nguyên liệu giữa giờ cao điểm.

### Vị trí blacklist

| Option | Description | Selected |
|--------|-------------|----------|
| Tab trong /admin/settings | 1 route mới duy nhất cho cả phase. Blacklist là việc thỉnh thoảng (M2.D-59 thêm tay) | ✓ |
| Trang riêng /admin/blacklist | Khớp pattern /admin/users, /admin/audit. Đánh đổi: thêm route + mục menu cho bảng thường chỉ vài dòng | |

**User's choice:** Tab trong /admin/settings

### Form giờ mở cửa

| Option | Description | Selected |
|--------|-------------|----------|
| Mặc định chung + ngoại lệ theo thứ | 1 dòng "mở 10:00-22:00 mọi ngày" + chỉ thêm ngoại lệ. Quán ăn thực tế gần như luôn cùng giờ | ✓ |
| Form 7 dòng đầy đủ | Rõ ràng, không có khái niệm "ngoại lệ" ẩn. Đánh đổi: nhập 7 lần cùng một con số, dễ sai 1 dòng không ai phát hiện | |

**User's choice:** Mặc định chung + ngoại lệ theo thứ

### Màu cho trang settings mới

| Option | Description | Selected |
|--------|-------------|----------|
| Theo pattern hiện có của apps/web | Giống AdminUsersPage/AdminAuditPage để admin không thấy lạc quẻ. Giữ scope đúng REQ-I..L. Đánh đổi: nợ hardcode màu không được trả | ✓ |
| Tạo tokens.css cho apps/web luôn | Trả nợ màu cho cả admin. Đánh đổi: refactor 12 trang admin đang chạy production — rủi ro cao, nên là phase riêng | |
| Tạo tokens.css nhưng chỉ áp cho trang mới | Đánh đổi: 2 hệ màu song song trong 1 app — người sau không biết theo cái nào | |

**User's choice:** Theo pattern hiện có của apps/web

---

## Xác nhận 3 giả định của 08-UI-SPEC.md

### Card "Nhận hàng" ở bước nào

| Option | Description | Selected |
|--------|-------------|----------|
| Bước 2 /checkout (như UI-SPEC đề xuất) | Đúng tên bước "Thông tin nhận hàng". Đánh đổi: bước 1 không biết PICKUP/DELIVERY nên "Phí giao hàng" phải ghi "chọn ở bước sau" | ✓ |
| Bước 1 /cart (như bản gốc Lotteria) | Card tổng tiền bước 1 hiện được kết luận phí ship thật. Đánh đổi: phương thức nhận hàng nằm ở bước trước bước mang tên đó | |

**User's choice:** Bước 2 /checkout — giữ như UI-SPEC

### Nút + khi công tắc OFF

| Option | Description | Selected |
|--------|-------------|----------|
| Nút + vẫn bấm được, chỉ khóa ĐẶT HÀNG | Khách vẫn xây giỏ để biết tổng tiền rồi gọi điện — đúng tinh thần M2.D-26. Đánh đổi: có thể xây giỏ xong mới biết không gửi được | ✓ |
| Khóa luôn nút + từ trang menu | Rõ ngay từ đầu. Đánh đổi: khách không xem được tổng tiền để gọi điện đặt — mất luôn đơn gọi thoại | |

**User's choice:** Nút + vẫn bấm được — giữ như UI-SPEC

### Tông giọng lỗi blacklist

| Option | Description | Selected |
|--------|-------------|----------|
| Trung tính, không nói "bị chặn" | Không khiêu khích người bom đơn, không oan cho khách bị thêm nhầm | ✓ |
| Nói thẳng là bị chặn | Rõ ràng, khách không thử lại vô ích. Đánh đổi: người bom đơn biết ngay để đổi số; khách bị thêm nhầm rất dễ tức | |

**User's choice:** Trung tính — giữ như UI-SPEC

> 7 giả định còn lại của UI-SPEC (#2, #5, #6, #7, #8, #9, #10) không đưa ra hỏi — giữ nguyên như researcher đề xuất.

---

## Cơ chế công tắc & anti-abuse

### "OFF đến hết hôm nay" tự ON lại 00:00

| Option | Description | Selected |
|--------|-------------|----------|
| Tính lúc đọc, không cần cron | Lưu `off_until`, so với giờ hiện tại mỗi lần đọc. Sống sót qua restart container và mất điện VPS. Dùng cùng cơ chế cho "ngoài giờ mở cửa" | ✓ |
| Cron 00:00 bật lại cờ | Đúng như spec mô tả. Đánh đổi: restart lúc 23:58 → quán OFF suốt ngày sau mà không ai biết. Repo đang có 2 cron chết | |

**User's choice:** Tính lúc đọc, không cần cron
**Notes:** Lệch cách spec mô tả nhưng không lệch hành vi yêu cầu (M2.D-28 chỉ yêu cầu "tự ON lại 00:00").

### Rate limit theo SĐT

| Option | Description | Selected |
|--------|-------------|----------|
| Đếm trong DB | Đã phải truy `online_order_requests` để check "1 đơn mở/SĐT" nên không thêm hạ tầng. Sống sót qua restart | ✓ |
| Throttler in-memory với key là SĐT | Nhanh, không query DB. Đánh đổi: restart là mất sạch bộ đếm — người bom đơn chỉ cần đợi deploy | |
| Thêm Redis | Chuẩn công nghiệp. Đánh đổi: thêm 1 service vào docker-compose cho 1 quán lẩu chạy 1 container | |

**User's choice:** Đếm trong DB
**Notes:** Rate limit theo IP giữ nguyên `@nestjs/throttler` global 600 req/phút đã có từ phase 7.

---

## Claude's Discretion

Chủ dự án không được hỏi các điểm sau (theo philosophy: technical implementation details thuộc Claude):
- Cách chia phase 8 thành các plan (BE trước rồi FE, hay slice dọc)
- Tên bảng/cột, tên module Nest, hình dạng DTO — theo §schema của spec
- Cách hash IP cụ thể (M2.D-56), miễn không lưu IP thô
- Chọn bao nhiêu test và test cái gì, miễn phủ 4 criteria đã LOCKED cần test tự động (C-TEST-01)
- Thư viện resize ảnh cụ thể cho D-12

## Deferred Ideas

- Nhiều ảnh thật cho 1 món (`menu_item_images` + sửa UI upload)
- `tokens.css` cho `apps/web` — trả nợ hardcode màu 12 trang admin
- Sync giỏ hàng đa tab qua `storage` event
- Đồng bộ `apps/shop/DESIGN.md` (`cat-1..7` pastel lạnh cũ) với `tokens.css` — drift có sẵn trong repo, do `gsd-ui-checker` phát hiện
- Thanh toán online VietQR/chuyển khoản — đã deferred sang v2 (M2.D-58 chốt COD)
