---
phase: 09-duy-t-n-th-ng-b-o-theo-d-i-n
plan: 10
wave: 5
status: complete-with-gap
completed_at: 2026-08-01
files_modified:
  - apps/web/src/lib/queue-clock.ts
  - apps/web/src/lib/queue-clock.test.ts
  - apps/web/src/lib/bell.ts
  - apps/web/src/lib/online-orders-sse.ts
  - apps/web/src/lib/online-orders-sse.test.ts
  - apps/web/src/pages/OnlineOrdersQueuePage.tsx
  - apps/web/src/App.tsx
verification: 29/29 test web · tsc web sạch · build production OK · trang có trong bundle · 3 kịch bản TRÊN TRÌNH DUYỆT CHƯA CHẠY
---

# 09-10 — Trang Hàng chờ duyệt (mặt trận A)

## Đã làm

**3 module lib:**

| File | Nội dung |
|---|---|
`queue-clock.ts` | `waitingSeconds` · `formatWait` (`m:ss`, phút KHÔNG chia dư 60 nên chờ 61 phút hiện `61:01`) · `isOverdue(seconds, threshold)` — **ngưỡng là tham số**, không có số nào cứng trong file |
`bell.ts` | `createBell()` → `unlock()`/`ring()`/`dispose()`. Web Audio (`AudioContext` + `OscillatorNode`), 2 bíp 880/660 Hz. `unlock()` phát luôn 1 tiếng để nhân viên NGHE được là đã bật — bấm nút mà im lặng thì đúng là lỗi im lặng D-03 muốn tránh |
`online-orders-sse.ts` | `SSE_DEAD_MS = 10_000` · `connectionStateFrom()` (hàm thuần, 4 trạng thái) · `subscribeOnlineOrders()` bọc `EventSource` với backoff 1→2→5→10s và hàm cleanup |

**`OnlineOrdersQueuePage.tsx` (734 dòng)** — header + badge đỏ (ẩn khi 0) + chấm kết nối; 2 banner
chiếm chỗ (chuông tắt đứng TRƯỚC mất kết nối); danh sách `.card` gap 24 sắp FIFO; empty state; error
state có nút Thử lại; mỗi card có đồng hồ đếm giây (**một** `setInterval` chung cho cả trang), emoji
phương thức, địa chỉ + km cho DELIVERY, toggle "Xem N món" + tổng tiền, banner vàng món hết hàng với
checkbox **mặc định đã tick**, ô phí ship, 2 nút luôn hiện cho cả 3 role, luồng xác nhận có mờ dần
600ms tôn trọng `prefers-reduced-motion`, lỗi hiện trong chính card và KHÔNG bỏ đơn khỏi danh sách.

**Panel từ chối** inline (không hộp thoại nổi): 5 radio lấy nhãn từ `REJECT_REASON_TEXT` của
`@order/schemas` (không gõ lại chuỗi tiếng Việt ở FE), nhánh `OTHER` có input bắt buộc kèm chú thích
"Nội dung này khách sẽ đọc được", khối ghi chú nội bộ tách bằng nền xám + viền gạch đứt + nhãn ổ
khoá, `maxLength 500` + đếm ký tự còn lại, nút "Xác nhận từ chối" disabled tới khi chọn lý do.

**`App.tsx`** — route `/admin/online-orders` bọc `RoleGate allow={['admin','order','kitchen']}`,
đặt **ngoài** block `allow={['admin']}` (đã đọc lại xác nhận), + mục nav "H/chờ" cho **cả 3** role.

## Verify đã chạy

- `apps/web` test: **29/29 xanh** (16 cũ + 13 mới) — criteria đòi ≥13 mới
- `tsc --noEmit` apps/web: **sạch**
- `pnpm --filter @order/web build`: **OK**, và trang **có mặt trong bundle production** (grep
  "Hàng chờ duyệt" và "Chuông đang tắt" trong `dist/assets/*.js` đều = 1 → không phải dead code)
- Vite dev serve module trang: HTTP **200**
- Shape API khớp đúng cái trang đọc: `GET /admin/online-orders?status=WAITING` trả
  `escalate_sms_after_s: 90` + 15 khoá/dòng đúng như `AdminOnlineOrderRow`
- Bảng màu: mọi hex trong trang đều nằm trong danh sách đóng của 09-UI-SPEC (kiểm bằng script, 0 hex
  lạ) · `var(--` = 0 · `role ===` = 0 · `\b90\b` = 0 · `dashed` = 1 · không `<dialog`/`Modal`/`createPortal`

## ⚠️ 3 kịch bản trên trình duyệt CHƯA CHẠY — đây là lỗ hổng thật của plan này

Acceptance criteria của Task 3 yêu cầu mở `http://localhost:5173/admin/online-orders` rồi:
(a) đăng nhập role `kitchen` và xác nhận thấy đủ 2 nút; (b) bấm "Bật chuông" → banner biến mất, đặt
1 đơn từ trang khách → **nghe được tiếng** và đơn hiện < 2s; (c) `kill` API → sau ~10s chấm đỏ +
banner "Mất kết nối", bật lại API → tự nối lại và tải lại danh sách.

**Cả 3 chưa chạy.** Phiên làm việc này không có công cụ điều khiển trình duyệt, và 3 kịch bản đều
cần click thật + tai người (âm thanh) + quan sát render. **Không bịa kết quả.**

Những gì đã được chứng minh gián tiếp, và những gì CÒN LẠI phải kiểm bằng mắt:

| Kịch bản | Đã chứng minh gián tiếp | Còn phải kiểm bằng mắt |
|---|---|---|
| (a) 3 role vào được | BE đã trả **200** cho cả `order` và `kitchen` (09-07, có `curl`); route FE khai đúng 3 role và nằm ngoài gate admin-only (đã đọc lại code) | RoleGate FE thực sự cho qua khi đăng nhập bằng tài khoản `kitchen` |
| (b) chuông + đơn < 2s | SSE đầu-cuối đã đo **403 ms** ở 09-09; `bell.ts` dùng đúng khuôn Web Audio đã chạy production trong `ready-notifier.ts` | Banner biến mất sau khi bấm, và **có tiếng thật** phát ra |
| (c) SSE đứt/nối lại | `connectionStateFrom` có **6 test** phủ cả 4 trạng thái + case proxy buffer; heartbeat 15s đã đo thật ở 09-07 | Chấm đổi đỏ + banner hiện đúng lúc, và danh sách được tải lại sau khi nối lại |

Cách kiểm nhanh (3 việc, ~5 phút): mở `http://localhost:5173/admin/online-orders` bằng tài khoản
`a` (role kitchen) → bấm "Bật chuông" → đặt 1 đơn ở `http://localhost:5174` → nghe tiếng + xem đơn
hiện ra; rồi tắt tiến trình API ~15s và xem chấm/banner.

## 3 acceptance criteria đếm-chuỗi bị lệch

| Criterion | Plan ghi | Thực tế | Ghi chú |
|---|---|---|---|
| `Mất kết nối` = 1 | 1 | **1** ✓ | Ban đầu 2 vì nhãn chấm kết nối dùng lại đúng chữ đó → đổi nhãn chấm thành "Không liên lạc được máy chủ" |
| `REJECT_REASON_TEXT` = 1 | 1 | **2** | Dòng `import` + dòng dùng. Không thể xuống 1 với named import — cùng loại lệch với `takeUntil` (09-07) và `computeProgress` (09-09) |
| `/admin/online-orders` trong `App.tsx` = 1 | 1 | **4** | 1 route + **3** mục nav. Chính plan (cùng Task 3) lại yêu cầu "thêm mục nav cho cả 3 role" — 2 yêu cầu không thể cùng đúng. Số đúng phải là 4 |

## Sửa lại bố cục sau phản hồi của chủ dự án (2026-08-01)

Chủ dự án xem bản đầu và đánh giá "rất xấu và thiếu khoa học". Rà lại thì đúng — 5 vấn đề tổ chức
thông tin, cộng **1 lỗi bỏ sót chức năng**:

| Vấn đề bản đầu | Đã sửa |
|---|---|
| Danh sách món **nấp sau toggle** "Xem N món" — việc chính của trang là đọc đơn rồi quyết định, mà phải bấm thêm 1 lần | Món **luôn hiện sẵn**; chỉ thu gọn khi đơn dài hơn `ITEMS_VISIBLE_MAX` (5) món |
| Không có số thứ tự hàng chờ dù FIFO là quy tắc của trang | Thêm `#1`, `#2`… ở dải đầu mỗi card |
| Đồng hồ chờ 12px — tín hiệu quét quan trọng nhất lại nhỏ nhất màn hình | Lên **24px/700** (tái dùng cỡ Display có sẵn, không phát minh cỡ mới) |
| Card là một chồng `<p>` phẳng, không phân vùng | Chia **4 dải**: quét (thứ tự/phương thức/đồng hồ) → khách → món+tổng → hành động, có đường kẻ và nền phân tách |
| 2 nút to bằng nhau dù "Xác nhận" chiếm gần như mọi thao tác | `grid 2fr 1fr` — "Xác nhận" rộng gấp đôi, "Từ chối" thành nút phụ chữ đỏ. Vừa nhanh hơn vừa khó bấm nhầm sang nhánh không hoàn tác được |
| Phương thức chỉ là emoji lẫn trong câu chữ | Thành **chip có viền**, quét được |
| **`customer_map_link` và `customer_phone` có trong dữ liệu nhưng KHÔNG được dùng** — nhân viên phải copy tay số điện thoại và địa chỉ | Thêm nút **Gọi** (`tel:`) và **Mở bản đồ**. Đây là thiếu chức năng, không chỉ là xấu |

Thêm 2 cải tiến nhỏ: dòng tóm tắt "N đơn đã quá X giây — xử lý trước" ở đầu trang (chỉ hiện khi có
đơn quá hạn, nhân viên đứng xa vẫn biết); món hết hàng bị **gạch ngang** trong danh sách thay vì chỉ
được nhắc ở banner phía dưới.

**1 mở rộng chỗ-dùng của bảng màu, ghi lại để không ai tưởng là màu lạ:** bộ 3 màu alert
(`#fee2e2`/`#fecaca`/`#991b1b`) trước đây 09-UI-SPEC chỉ liệt kê cho **banner full-width**; nay dùng
thêm cho **viền + dải đầu của card khi đơn quá hạn**. Không thêm hex mới nào — chỉ mở rộng nơi dùng
của bộ màu đã chốt, để đơn quá hạn nhìn thấy được từ xa mà không cần đọc chữ.

Verify lại sau khi sửa: tsc sạch · 29/29 test · build production OK · trang vẫn trong bundle · 0 hex
lạ · mọi grep criteria giữ nguyên giá trị đúng. **3 kịch bản trình duyệt vẫn chưa chạy** — phần dưới
không đổi.

## Vòng sửa thứ 2 — đa thiết bị + radio vỡ (2026-08-01)

Chủ dự án báo: trên iPad và máy tính trang "quá ngắn", và panel lý do từ chối "bị vỡ và quá to"
(kèm ảnh: nút tròn phình to, chữ dạt sang phải và xuống dòng giữa câu). Cả hai là **lỗi thật**, không
phải chuyện thẩm mỹ:

### 1. Trang bị khoá ở chiều rộng điện thoại trên mọi thiết bị

`OnlineOrdersQueuePage` dùng `className="container"` trơn — là **trang làm việc DUY NHẤT** làm vậy.
`styles.css` khai `.container { max-width: 480px }` và `.container.wide { max-width: 960px }`; 10
trang còn lại (`OrdersPage`, `HistoryPage`, `AdminSettingsPage`, …) đều dùng
`container wide with-bottom-nav`. Thiếu `wide` → trang bị nhồi vào 480px trên cả iPad lẫn desktop.
Thiếu `with-bottom-nav` (`padding-bottom: 80px`) → **thanh nav dưới che mất card cuối danh sách**.

Đã đổi sang `container wide with-bottom-nav` cho khớp toàn app, và danh sách đơn chuyển từ 1 cột
cứng sang **lưới tự co** `repeat(auto-fill, minmax(320px, 1fr))`: điện thoại 1 cột, iPad ngang và
máy tính 2 cột. Không dùng media query — `auto-fill` tự quyết theo chiều rộng thật. `align-items:
start` để 1 card mở panel từ chối không kéo cao card bên cạnh.

### 2. 🐛 Global CSS làm vỡ MỌI radio/checkbox trong app (lỗi có từ trước)

`styles.css` dòng 61-70 khai `input, textarea { display:block; width:100%; min-height:44px;
padding:10px 14px; border:1px solid; border-radius:8px }` — quy tắc này áp **cả cho
`input[type=radio]` và `input[type=checkbox]`**. Kết quả: nút tròn/ô tick phình thành khối cao 44px
rộng hết dòng, đẩy nhãn sang phải và làm vỡ dòng chữ.

**Đã sửa ở `styles.css` (ngoài `files_modified` của plan, có chủ đích)** — thêm quy tắc riêng đưa
radio/checkbox về 20×20px, bỏ padding/border/width, `accent-color` theo màu accent của app. Sửa ở
tầng global vì đây là **defect dùng chung**: trang Cài đặt (2 radio chọn kiểu tạm ngưng nhận đơn)
đang vỡ đúng cùng một kiểu, và sửa riêng trong trang hàng chờ sẽ để nguyên lỗi ở đó.

⚠ Đây là thay đổi CSS **dùng chung cho 15 trang**. Rủi ro thấp (radio/checkbox full-width chưa bao
giờ là ý muốn), nhưng cần kiểm bằng mắt trang **Cài đặt** sau khi sửa — layout ở đó sẽ đổi (theo
hướng đúng hơn). Đã ghi vào phần "Nợ để lại".

Verify lại: tsc sạch · 29/29 test · build OK (`accent-color` có trong CSS bundle) · trang vẫn trong
JS bundle.

## Nợ để lại

- **Badge ở Dashboard: cố ý KHÔNG làm** ở phase này. RESEARCH Open Question #2 còn để ngỏ và D-05
  chỉ yêu cầu badge **trong trang hàng chờ**. Đã cân nhắc và bỏ qua có chủ đích.
- `bell.ts` **không có test tự động** — `AudioContext` không tồn tại trong môi trường vitest thuần và
  plan cấm thêm package. Đây là lý do 2 module kia có test mà module này không; hành vi của nó phải
  kiểm bằng tai ở kịch bản (b).
- Bundle `apps/web` production đã **1.008 MB** (gzip 314 kB) và Vite cảnh báo chunk > 500 kB. Trang
  mới không phải nguyên nhân chính nhưng làm nó lớn thêm. `apps/web` là công cụ nội bộ dùng trên máy
  quán nên chưa cấp bách; `apps/shop` (trang khách) vẫn có guard riêng và đang ở 204 kB.
