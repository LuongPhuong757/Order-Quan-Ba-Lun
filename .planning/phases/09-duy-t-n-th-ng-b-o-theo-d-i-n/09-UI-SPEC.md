---
phase: 9
slug: duyet-don-thong-bao-theo-doi-don
status: draft
shadcn_initialized: false
preset: none
created: 2026-07-31
---

# Phase 9 — UI Design Contract

> Hợp đồng thị giác và tương tác cho **HAI mặt trận khác ngân sách hoàn toàn**:
>
> **A. `apps/web` — `OnlineOrdersQueuePage` (`/admin/online-orders`)** — công cụ nội bộ, nhân viên
> nhìn cả ca làm việc. Tối ưu **tốc độ thao tác + không bỏ sót đơn**, không phải vẻ đẹp.
>
> **B. `apps/shop` — `/o/:token` (mở rộng)** — khách hàng trên di động. Tái dùng nguyên
> `08-UI-SPEC.md` + `tokens.css`, chỉ thêm phần REQ-O (progress + banner + rejected state).
>
> Sinh bởi `gsd-ui-researcher`, xác minh bởi `gsd-ui-checker`.
>
> **Nguồn sự thật khi có xung đột — Mặt A:** `.planning/phases/09-*/09-CONTEXT.md` (D-01..D-21,
> LOCKED) > file này > `docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md` (bản gốc, một số phần đã bị
> ghi đè — xem cảnh báo trong CONTEXT.md).
> **Nguồn sự thật khi có xung đột — Mặt B:** `apps/shop/src/styles/tokens.css` > `08-UI-SPEC.md` >
> file này.

---

## Design System

| Property | Mặt A — `apps/web` | Mặt B — `apps/shop` |
|----------|--------------------|-----------------------|
| Tool | **none** — không có `components.json`, không Tailwind. Xác nhận qua đọc `MenuManagementPage.tsx`, `AdminSettingsPage.tsx`, `NotificationBell.tsx`, `KitchenPage.tsx`: toàn bộ hardcode hex + px trong `style={{...}}`, cùng 1 stylesheet global `apps/web/src/styles.css` cho các class dùng chung (`.card`, `.secondary`, `.danger`, `table.responsive`, thẻ `button`/`input` mặc định) | **none** — đã chốt ở `08-UI-SPEC.md`, không đổi |
| Component library | React thuần, `CSSProperties` inline + vài class global (`.card`, `.secondary`, `.danger`) | React thuần + `CSSProperties`, đọc token qua `var(--...)` |
| Icon library | **Không dùng package icon.** Quy ước hiện có: **emoji Unicode trực tiếp trong JSX** (`🔔`, `🍽`, `✕`, `💰`, `⚠️`, `👤` — xem `NotificationBell.tsx`, `KitchenPage.tsx`). Phase 9 giữ đúng quy ước này cho `apps/web`, **không** chuyển sang SVG tự vẽ (khác hẳn quy ước `apps/shop`) | **Không dùng package icon** — SVG tự vẽ tay `stroke="currentColor"`, đúng quy ước `08-UI-SPEC.md` (xem `CheckGlyph` trong `OrderTrackPage.tsx` làm mẫu) |
| Font | `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif` — khai ở `styles.css:11`, không đổi | `Baloo 2` (700/800) + `Be Vietnam Pro` (400/600), tự host — không đổi |

**Vì sao "Tool: none" cho cả hai, không mở gate shadcn:** `apps/web` đã có 1734 dòng CSS + pattern hardcode nhất quán từ Milestone 1 (6 phase); `apps/shop` đã có `tokens.css` hoàn chỉnh từ phase 7-8. Cả hai codebase đều **cố ý không dùng Tailwind/shadcn** — chèn giữa milestone sẽ tạo ra 3 hệ thống thiết kế song song. Không phải né hỏi: đây là quyết định tiếp nối bắt buộc theo đúng chỉ dẫn scope của task này ("KHÔNG đưa token system của apps/shop sang apps/web").

**Khuyến nghị lùi lại (không thuộc phạm vi phase 9):** `apps/web` không có design token file — mọi lần đổi màu thương hiệu phải sửa nhiều nơi. Nên rút `#0f766e`/`#dc2626`/`#f59e0b`/`#6b7280`/`#1f2937`/`#d1d5db`/`#f9fafb` thành CSS custom properties trong `styles.css` ở một phase riêng, theo đúng tinh thần `tokens.css` đã làm cho `apps/shop`. Ghi nhận, không làm trong phase này.

---

## Spacing Scale — Mặt A (`apps/web`)

Không có thang chính thức trong `styles.css` (giá trị px rải rác: 4, 6, 8, 10, 12, 14, 16, 18, 24, 32...).
Phase 9 viết code mới theo đúng thang 4px chuẩn dưới đây — **không phát minh giá trị lẻ mới**:

| Token | Giá trị | Dùng cho |
|-------|--------|----------|
| xs | 4px | Khoảng cách icon-chữ (emoji + label) |
| sm | 8px | Gap giữa nút Xác nhận/Từ chối, giữa badge và chữ |
| md | 16px | Padding mặc định trong row/card, gap giữa các field |
| lg | 24px | Padding section, khoảng cách giữa các đơn trong danh sách |
| xl | 32px | Khoảng cách khối (header trang ↔ danh sách hàng chờ) |

Exceptions (đã có sẵn trong `styles.css`, áp dụng nguyên cho phase 9):
- `44px` — sàn Apple HIG cho mọi nút bấm (`button { min-height: 44px; min-width: 44px }` — global, tự động áp dụng, không cần khai lại).
- Banner "Bật chuông" / "Mất kết nối": full-width, `padding: 12px 16px`, không dưới 48px chiều cao để dễ đọc từ xa khi đứng bếp/quầy.

## Spacing Scale — Mặt B (`apps/shop`)

**Tái dùng nguyên `tokens.css` `--sp-1..--sp-16`** đã khoá ở `08-UI-SPEC.md` — không khai lại. Riêng
phần mở rộng REQ-O:
- Stepper 5 mốc: gap giữa các node = `flex:1` (đường nối chiếm hết chỗ còn lại), node cách viền card `--sp-4`.
- Banner "quán vừa cập nhật đơn" tái dùng `container` style của `BannerNotice.tsx` (đã có).

---

## Typography — Mặt A (`apps/web`)

`styles.css` không có thang chữ chính thức nhưng có 5 giá trị đã lặp lại nhất quán qua nhiều trang
(`h1` 24px, `h2` 20px, body/input 16px, badge/meta 12-13px). Phase 9 **tái dùng đúng 5 giá trị này**,
không thêm cỡ mới:

| Role | Size | Weight | Line Height | Dùng ở đâu (phase 9) |
|------|------|--------|-------------|----------------------|
| Display | 24px | 700 | 1.3 | Tiêu đề trang "Hàng chờ duyệt (N)" — `h1`, kế thừa mặc định `styles.css` |
| Heading | 20px | 600 | 1.35 | Không dùng trực tiếp trong queue (không có section con) — dự phòng nếu chia nhóm PICKUP/DELIVERY |
| Body | 16px | 400 | 1.5 | Tên khách, SĐT, tên món trong dòng đơn, input phí ship, textarea ghi chú nội bộ |
| Label/Meta | 13px | 500 | 1.4 | Thời gian gửi đơn, mã đơn, nhãn "Lý do gửi tới khách" / "Ghi chú nội bộ" |
| Badge/Caption | 12px | 700 | 1 | Số trong badge đếm đơn chờ, đồng hồ đếm giây chờ per-order |

Input **luôn 16px** — đã là mặc định toàn cục (`input, textarea { font-size: 16px }`), không cần khai lại.

## Typography — Mặt B (`apps/shop`)

**Tái dùng nguyên bảng đã khoá ở `08-UI-SPEC.md`.** Riêng phần mở rộng REQ-O dùng đúng token đã dự
phòng sẵn trong `tokens.css` (comment gốc ghi rõ mục đích, không phải chọn mới):

| Role | Token | Size | Weight | Dùng cho |
|------|-------|------|--------|----------|
| % tiến độ | `--fs-3xl` | 36px | `--fw-heavy` (800) | Số phần trăm lớn, `tokens.css:149` đã ghi chú "số % ở trang theo dõi đơn" |
| Nhãn mốc hiện tại | `--fs-lg` | 20px | `--fw-bold` (700) | `stage_label` ("Đang nấu", "Đang giao"...) dưới số % |
| ETA phụ | `--fs-sm` | 14px | `--fw-normal` | "Dự kiến còn khoảng X-Y phút" (chỉ hiện nếu API trả `eta_min`/`eta_max`) |
| Banner rejected/info | `--fs-base` / `--fs-sm` | 16px / 14px | theo `BannerNotice` hiện có (title bold, body muted) | Banner từ chối, banner cập nhật đơn |

---

## Color — Mặt A (`apps/web`)

Không hex mới ngoài 2 tint nền banner (ghi rõ bên dưới) — **mọi màu chữ/nút tái dùng đúng hex đã
chạy trong production**, không phát minh màu thương hiệu mới.

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#f9fafb` (nền trang) + trắng (`.card`, hàng trong danh sách) | Nền trang, nền mỗi dòng đơn trong hàng chờ |
| Secondary (30%) | Viền `#d1d5db`/`#e5e7eb`, `.card` (bo góc 12px, `box-shadow: 0 1px 3px rgba(0,0,0,.06)`) | Khung mỗi đơn, khung banner |
| Accent (10%) | `#0f766e` (teal — màu nút mặc định `<button>` toàn app, không cần class riêng) | **CHỈ** dùng cho: nút "Xác nhận" (nút mặc định, không thêm class), chấm trạng thái kết nối SSE khi đang nối tốt (mới, cùng họ màu "ready" đã dùng ở `NotificationBell` — thực ra dùng `#059669` xem dưới) |
| Destructive | `#dc2626` (class `.danger` có sẵn) | **CHỈ** dùng cho: nút "Từ chối", banner "🔕 Chuông đang tắt", banner "Mất kết nối — đang thử nối lại", badge số đơn chờ (nền đỏ chữ trắng, đúng pattern `NotificationBell` badge sẵn có) |
| Semantic phụ — Warn | `#f59e0b` (đã dùng cho cảnh báo "chưa cấu hình giờ mở cửa" ở `AdminSettingsPage`) | Nhãn cảnh báo "⚠ N món đã hết hàng" trong dòng đơn — **không dùng đỏ** để không lẫn với "Từ chối"/lỗi hệ thống |
| Semantic phụ — Connected | `#059669` (đúng hex "ready" đã dùng ở `NotificationBell.tsx:15`) | Chấm trạng thái kết nối SSE khi đang nối tốt |

**Accent reserved for (danh sách đóng):** nút "Xác nhận" (nút mặc định) · chấm kết nối SSE màu xanh.
**Destructive reserved for (danh sách đóng):** nút "Từ chối" · banner chuông tắt · banner mất kết nối ·
badge số đơn chờ.

**2 nền banner mới (chưa từng dùng trong `apps/web`, cần thêm — cùng họ hue với hex đã có, không phải
màu thương hiệu mới):**

| Token gợi ý (đặt tên khi code, không phải biến CSS đã tồn tại) | Hex | Cặp với | Dùng cho |
|---|---|---|---|
| nền banner đỏ nhạt | `#fee2e2` | viền `#fecaca`, chữ `#991b1b` | Banner "🔕 Chuông đang tắt", banner "Mất kết nối" |
| nền banner vàng nhạt | `#fef3c7` | viền `#fde68a`, chữ `#92400e` | Banner inline "⚠ N món đã hết hàng" trong dòng đơn |

## Color — Mặt B (`apps/shop`)

**Tái dùng nguyên `tokens.css`**, không hex mới. Phần mở rộng REQ-O map đúng theo comment sẵn có
trong file token (không phải suy diễn — tokens.css đã ghi rõ mục đích từng biến):

| Trạng thái | Token | Usage |
|-----------|-------|-------|
| `RECEIVED` (chờ duyệt) | `--warn-600` / `--warn-100` | Node đầu tiên của stepper khi đơn còn `WAITING` |
| `CONFIRMED` / `COOKING` / `DELIVERING` / `READY_FOR_PICKUP` (đang xử lý) | `--ok-600` / `--ok-100` | Node đã qua + node hiện tại khi đang chạy — đúng comment gốc "Đã xác nhận, đang giao" |
| `COMPLETED` | `--ok-600` filled + icon check | Node cuối |
| `REJECTED` | `--danger-600` / `--danger-100` | Thay **toàn bộ** stepper bằng 1 icon + banner, không vẽ node dở dang |
| Banner "quán vừa cập nhật đơn" (món bị huỷ) | `--info-600` / `--info-100` | Đúng comment gốc tokens.css dòng ~99 dành riêng cho banner này |
| Số % | `--ok-600` | Đồng bộ màu với semantics "đang tiến triển tốt" |

**Việc cần làm ở `BannerNotice.tsx` (không phải thiết kế lại, chỉ mở rộng):** component hiện chỉ có
`Tone = 'brand' | 'warn' | 'danger'`. Phase 9 cần thêm **tone thứ 4: `'info'`** dùng `--info-600`/`--info-100`
đã có sẵn trong `tokens.css` nhưng chưa được `BannerNotice` dùng tới. Đây là mở rộng union type + 1 dòng
trong `TONE_STYLES`, không phải viết component mới.

---

## Copywriting Contract — Mặt A (`apps/web`)

| Element | Copy |
|---------|------|
| Tiêu đề trang | **"Hàng chờ duyệt"** + badge số `(N)` cạnh tiêu đề khi N > 0, ẩn badge khi N = 0 |
| Primary CTA — duyệt đơn | **"Xác nhận"** (nút mặc định, không icon) |
| Destructive CTA — từ chối | **"Từ chối"** (`.danger`) |
| Banner bắt buộc — âm thanh chưa mở khoá (D-03) | Tiêu đề **"🔕 Chuông đang tắt"** + body **"Bấm để bật thông báo đơn mới"** + nút **"Bật chuông"** |
| Banner mất kết nối (D-07, sau ~10s) | Tiêu đề **"⚠ Mất kết nối"** + body **"Đang thử nối lại — đơn mới có thể chưa hiện ngay."** |
| Chấm kết nối — đang tốt | tooltip/aria-label **"Đang kết nối"** (chấm xanh `#059669`) |
| Chấm kết nối — đang thử lại (< 10s, chưa tới ngưỡng banner) | tooltip **"Đang kết nối lại..."** (chấm vàng `#f59e0b`) |
| Cảnh báo tồn kho trong dòng đơn | **"⚠ {N} món đã hết hàng"** + mỗi món hết hàng có checkbox **"Bỏ món này khỏi đơn"** (mặc định **đã tick sẵn**, staff bỏ tick nếu biết chắc còn hàng) |
| Ô nhập phí ship (chỉ hiện khi `fulfillment_type === 'DELIVERY'`) | Label **"Phí ship (nếu có)"**, placeholder **"0"**, đơn vị "đ" |
| Empty state (không có đơn chờ) | Heading **"Không có đơn nào đang chờ 🎉"** + body **"Đơn mới sẽ tự hiện ở đây, không cần tải lại trang."** |
| Error state (tải hàng chờ lỗi) | **"Không tải được hàng chờ. "** + nút **"Thử lại"** |
| Panel từ chối — nhãn lý do khách thấy | **"Lý do gửi tới khách"** (5 lựa chọn radio, xem bảng dưới) |
| Panel từ chối — nhãn ghi chú nội bộ | **"🔒 Ghi chú nội bộ — khách KHÔNG thấy"** (nền `#f6ecd9`-tương-đương xám nhạt `#f3f4f6`, viền chấm gạch, tách biệt rõ khỏi khối lý do phía trên) |
| Panel từ chối — nút xác nhận | **"Xác nhận từ chối"** (`.danger`) — disable tới khi đã chọn 1 lý do |
| Panel từ chối — nút huỷ | **"Huỷ"** (`.secondary`) — đóng panel, không gửi gì |
| Toast sau khi Xác nhận | **"Đã xác nhận — bàn {code}"** (tái dùng `useToast`, kiểu `success`) |
| Toast sau khi Từ chối | **"Đã từ chối đơn"** (kiểu `success` — hành động hoàn tất đúng ý, không phải lỗi) |
| Destructive confirmation | **Từ chối đơn**: không dùng modal "Bạn có chắc?" chung chung — bản thân panel chọn lý do (bắt buộc chọn 1/5 + xem trước ghi chú nội bộ tách biệt) **chính là** bước xác nhận. Không thêm lớp confirm thứ 2 (làm chậm thao tác, ngược tinh thần "tốc độ" của trang này) |

**5 lý do từ chối soạn sẵn (D-08, Claude's Discretion — trung tính, không đổ lỗi khách):**
1. Hết nguyên liệu món đã đặt
2. Ngoài khu vực giao hàng
3. Quán đang quá tải, chưa thể nhận thêm
4. Không liên lạc được với khách
5. Lý do khác (ghi rõ bên dưới — hiện ô nhập khi chọn mục này, nội dung **cũng đi tới khách** vì đây vẫn là `reject_reason`, khác với ô ghi chú nội bộ)

## Copywriting Contract — Mặt B (`apps/shop`)

| Element | Copy |
|---------|------|
| Nhãn mốc (5 giá trị `stage_label`, do BE trả — FE chỉ hiển thị nguyên văn) | "Đã tiếp nhận" (RECEIVED) · "Đã xác nhận" (CONFIRMED) · "Đang chuẩn bị" (COOKING) · "Đang giao" (DELIVERING) / "Sẵn sàng lấy hàng" (READY_FOR_PICKUP) — chọn 1 trong 2 theo `fulfillment_type` · "Hoàn tất" (COMPLETED) |
| Banner đơn bị từ chối (D-10) | Tiêu đề **"Đơn đã bị từ chối"** + body = **`reject_reason` nguyên văn từ API** (không thêm chữ đệm nào che hoặc giảm nhẹ) + nút gọi quán (tái dùng `ctaButton`) |
| Banner món bị huỷ khi quán sửa đơn (M2.D-21 "che là lừa khách") | Tiêu đề **"Quán đã cập nhật đơn của bạn"** + body **"{N} món không còn phục vụ được: {tên món, phân cách phẩy}. Rất xin lỗi vì sự bất tiện này."** — tone `info` |
| ETA phụ (chỉ hiện nếu API trả `eta_min`/`eta_max`) | **"Dự kiến còn khoảng {eta_min}–{eta_max} phút"** |
| Câu chữ Đóng cửa — banner trang khách (D-11, D-14 — **runtime, sửa được ở `/admin/settings`, không phải literal cứng**) | Mặc định: *"Hiện chúng tôi đang đóng cửa, đơn của quý khách cứ tiếp tục đặt và chúng tôi sẽ xử lý sớm nhất có thể"* |
| Câu chữ Đóng cửa — màn xác nhận sau submit (D-11, D-14 — runtime) | Mặc định: *"Chúng tôi đã tiếp nhận đơn, và sẽ liên hệ khi quán mở lại"* (thay cho "Đặt hàng thành công") |
| Nút gọi quán | Không đổi — tái dùng `ctaButton` đã có ở `OrderTrackPage.tsx` |
| Destructive confirmation | Không có thao tác phá huỷ nào ở mặt khách trong phase 9 |

⚠ **2 câu chữ trên là runtime content lấy từ `store_settings` (D-14), KHÔNG phải string cứng trong
code** — executor phải thiết kế layout chịu được độ dài văn bản thay đổi (banner co giãn chiều cao,
không cắt chữ `text-overflow: ellipsis`, không giới hạn 1 dòng).

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | không dùng (Tool: none cả 2 mặt) | không áp dụng |
| third-party | không dùng | không áp dụng |

---

## Phần bổ sung — Kiến trúc màn hình (dành cho planner/executor)

> Các mục dưới đây bổ sung ngoài 6 mục chuẩn của template, theo đúng tinh thần "prescriptive,
> not exploratory".

### A. `OnlineOrdersQueuePage` (`apps/web`, `/admin/online-orders`)

**Bố cục tổng thể (top → bottom):**
1. Header trang: `<h1>Hàng chờ duyệt</h1>` + badge đỏ tròn `(N)` cạnh tiêu đề (ẩn khi N=0) + chấm
   trạng thái kết nối SSE (xanh/vàng/đỏ, 10px, `border-radius: 999px`) căn phải cùng hàng với `<h1>`.
2. Banner "🔕 Chuông đang tắt" (nếu audio chưa unlock) — **luôn** nằm ngay dưới header, full-width,
   chiếm chỗ thật (không phải toast biến mất), đứng trước cả banner mất kết nối nếu cả hai cùng xảy ra
   (mất chuông nghiêm trọng hơn — không nghe được nghĩa là mất luôn 2 kênh cảnh báo).
3. Banner "⚠ Mất kết nối" (nếu SSE đứt > ~10s) — cùng vị trí, xếp dưới banner chuông nếu cả hai hiện.
4. Danh sách hàng chờ: mỗi đơn 1 "card" (class `.card`), xếp dọc, gap `24px` (`lg`).
5. Empty state khi N=0: card căn giữa, heading + body theo bảng Copywriting.

**Sắp xếp danh sách — FIFO ổn định (Claude's Discretion, xem Giả định #1):** sắp theo
`created_at ASC` (đơn chờ lâu nhất lên đầu). Đơn mới tới qua SSE **nối vào cuối danh sách hiện có**,
KHÔNG chèn lên đầu và KHÔNG sắp xếp lại toàn bộ list mỗi khi có sự kiện — tránh danh sách nhảy lung
tung trong lúc admin đang rê chuột/chạm vào 1 dòng để duyệt. Khi SSE reload toàn bộ theo D-06 (lần đầu
mở / mỗi lần nối lại), list được thay bằng dữ liệu mới nhưng **thứ tự vẫn theo `created_at ASC`** nên
không có cảm giác giật hình.

**Mỗi dòng đơn (card) gồm:**
- Hàng đầu: mã đơn/thời gian gửi (`13px`, `#6b7280`) bên trái · **đồng hồ đếm giây chờ** (D-05, cập
  nhật mỗi giây, `12px`/`700`) bên phải — màu `#1f2937` (bình thường) nếu < `escalate_sms_after_s`
  (mặc định 90s), chuyển `#dc2626`/`700` kèm icon nhỏ khi ≥ ngưỡng đó (đúng lúc SMS đã bắn — báo hiệu
  "admin đã bỏ lỡ mốc quan trọng nhất").
- Icon phương thức (emoji: 🛵 DELIVERY / 🏠 PICKUP) + tên khách + SĐT (`16px`).
- Nếu DELIVERY: địa chỉ/toạ độ rút gọn 1 dòng.
- Danh sách món (rút gọn, expand/collapse — "Xem N món" toggle) + tổng tiền.
- Nếu có món hết hàng: banner inline vàng nhạt "⚠ N món đã hết hàng" + checkbox từng món (mặc định
  tick = loại khỏi đơn khi xác nhận).
- Nếu DELIVERY: ô nhập "Phí ship (nếu có)" (number input, 16px, sàn 44px chiều cao theo global CSS).
- Hàng cuối: 2 nút cạnh nhau **"Xác nhận"** (mặc định, trái hoặc phải tuỳ RTL — dùng trái trước) và
  **"Từ chối"** (`.danger`) — **cả 2 nút luôn hiện cho cả 3 role** `admin`/`order`/`kitchen` (D-02,
  KHÔNG ẩn theo role). Route bọc `<RoleGate allow={['admin','order','kitchen']} />` đúng pattern
  `App.tsx` đã có cho `/kitchen`, `/tables`.

**Sau khi bấm Xác nhận:** disable 2 nút, gọi API, khi thành công → hiện icon check + fade nhẹ
(`opacity` transition ~600ms, tôn trọng `prefers-reduced-motion`) rồi remove khỏi list (vì
`GET .../online-orders?status=WAITING` không còn trả nó) + toast "Đã xác nhận — bàn {code}". Khi lỗi
(hết bàn dù M2.D-05 đảm bảo tự tạo, hoặc lỗi mạng) → banner lỗi đỏ nhạt trong chính dòng đơn, 2 nút
bật lại, KHÔNG remove khỏi list.

**Bấm Từ chối → panel inline mở rộng ngay trong dòng đơn (KHÔNG dùng modal — Claude's Discretion, xem
Giả định #3):** danh sách radio 5 lý do (nhãn "Lý do gửi tới khách"), tiếp theo là khối
**tách biệt rõ ràng bằng nền xám `#f3f4f6` + viền gạch đứt** chứa textarea "🔒 Ghi chú nội bộ — khách
KHÔNG thấy" (tối đa 500 ký tự, đếm ký tự còn lại như mẫu `AdminSettingsPage` đã có ở ô "Lý do hiện cho
khách"). 2 nút "Huỷ" / "Xác nhận từ chối" cuối panel. Panel đẩy các dòng đơn khác xuống (danh sách
hàng chờ ở quy mô 1 quán nhỏ, không cần ảo hoá danh sách).

**Chuông (D-03/D-04):**
- Audio element ẩn (`<audio>` không hiển thị), unlock theo pattern `Pattern 4` của `09-RESEARCH.md`
  (gọi `.play()` trong chính `onClick` của banner/nút "Bật chuông").
- Sau khi unlock: lặp phát mỗi 5 phút đúng khi còn ≥1 đơn `WAITING` (kiểm tra bằng danh sách hiện có
  trên client, không cần API riêng).
- Không có UI riêng để tắt chuông vĩnh viễn trong phase này (mặc định BẬT cho cả 3 role, D-04) — nếu
  cần tắt tạm, đóng tab là đủ.

**Chấm kết nối + banner mất kết nối (D-07):**
- Xanh `#059669`: SSE đang mở, nhận event bình thường.
- Vàng `#f59e0b` (mới, discretion nhỏ để mượt UX): đang thử kết nối lại, chưa quá ngưỡng 10s.
- Đỏ `#dc2626` + banner "⚠ Mất kết nối" (D-07, ngưỡng ~10s theo gợi ý CONTEXT.md — planner chốt số
  chính xác khi thi công): mất kết nối kéo dài.
- Mỗi lần chuyển từ đỏ → xanh (reconnect thành công): tự động gọi lại
  `GET /admin/online-orders?status=WAITING` để đồng bộ toàn bộ (D-06), ẩn banner ngay.

### B. `/o/:token` — mở rộng REQ-O (`apps/shop`)

> Chỉ phần **mới** so với `08-UI-SPEC.md`. Toàn bộ header trang, danh sách món, tổng tiền, nút gọi
> quán **giữ nguyên vị trí đã có** trong `OrderTrackPage.tsx` — phần dưới đây chèn vào đúng vị trí
> comment `{/* ── Chỗ chèn phase 9 (REQ-O) ── */}` đã đánh dấu sẵn trong file.

**Khi `status !== 'REJECTED'` — Stepper 5 mốc ngang (Claude's Discretion, xem Giả định #4):**
- Ngang, KHÔNG dọc, kể cả ở màn 375px — lý do: khớp mental model quen thuộc của khách Việt với các
  app giao đồ ăn phổ biến (dấu chấm + đường nối ngang), và tiết kiệm chiều cao dọc để danh sách món
  vẫn nhìn thấy mà không cuộn quá nhiều.
- 5 node tròn nối bằng đường kẻ `flex: 1` giữa các node. Node đã qua: fill `--ok-600` + icon check
  trắng nhỏ. Node hiện tại: fill theo bảng Color (warn nếu còn `RECEIVED`, ok nếu đã `CONFIRMED` trở
  lên) + viền `--focus-ring`-style pulse nhẹ (tôn trọng `prefers-reduced-motion`). Node chưa tới: viền
  `--border-default`, nền `--bg-surface`, icon mờ `--text-faint`.
- **Không hiện 5 nhãn chữ cùng lúc** (không đủ chỗ ở 375px) — chỉ hiện **1 dòng chữ lớn** ngay dưới
  stepper: `stage_label` hiện tại (`--fs-lg`/`--fw-bold`).
- Phía trên hoặc dưới stepper: số **`{percent}%`** to (`--fs-3xl`/`--fw-heavy`/`--ok-600`), kèm ETA phụ
  nếu API có trả (`--fs-sm`/`--text-muted`).
- Kích thước node: 20px (đã qua/hiện tại), 14px (chưa tới); đường nối cao 2px. Trên < 400px, giữ
  nguyên kích thước này (không thu nhỏ thêm) — 5×20px + 4 đoạn nối vẫn vừa 320px viewport tối thiểu.

**Khi `status === 'REJECTED'`:** **thay hẳn** stepper bằng banner tone `danger` (dùng nguyên
`BannerNotice`) — không vẽ node "dở dang" nào, vì đơn đã kết thúc, không còn khái niệm "tiến độ".
Ẩn số `%`. Danh sách món + tổng tiền vẫn hiện nguyên (khách vẫn cần xem lại đã đặt gì).

**Banner "quán vừa cập nhật đơn" (món bị huỷ):** đặt **ngay trên** stepper/banner rejected (thứ tự đọc
từ trên xuống: banner cập nhật → banner rejected/stepper → danh sách món). Chỉ hiện khi
`cancelled_count > 0`. Copy theo bảng Copywriting, tone `info` (cần thêm tone này vào `BannerNotice.tsx`
— xem mục Color ở trên).

**⚠ Ngân sách bundle — HARD CONSTRAINT:** `scripts/check-shop-bundle.sh` giới hạn 370 kB, build hiện
tại đã 352 kB → **chỉ còn ~18 kB (~4.9%) cho toàn bộ phần B ở trên**. Do đó:
- **Không** thêm bất kỳ npm package mới nào cho `apps/shop` (không chart lib, không animation lib,
  không icon package) để dựng stepper — chỉ CSS (`flex`, `border-radius`, `transform`/`opacity`
  transition) + 1-2 SVG icon tự vẽ tay (check mark, dấu X cho rejected) theo đúng khuôn `CheckGlyph`
  đã có trong `OrderTrackPage.tsx`.
- Chạy `sh scripts/check-shop-bundle.sh` sau khi thêm code — nếu vượt ngưỡng, cắt bớt trước khi coi
  plan xong, không nới ngưỡng script.

---

## Giả định cần chủ dự án xác nhận

> Đúng 4 điểm còn mở theo `<ask_only_what_is_unanswered>` — quyết theo lý lẽ vận hành, không phải
> quyết định đã khoá bằng chữ. Planner/executor cứ theo các quyết định này để không bị chặn tiến độ;
> nếu chủ dự án muốn đổi, sửa mục tương ứng ở trên rồi build lại.

1. **Sắp xếp hàng chờ: FIFO ổn định (`created_at ASC`), đơn mới nối vào cuối, không tự sắp lại giữa
   chừng.** Cân nhắc: đơn chờ lâu nhất lên đầu giúp không bỏ sót đơn cũ, nhưng nghĩa là đơn mới nhất
   (thường là gấp nhất theo trực giác) nằm cuối — bù lại bằng đồng hồ đếm giây + màu đỏ ở ngưỡng 90s
   nên đơn nào cần gấp vẫn nổi bật dù ở vị trí nào.
2. **Sau khi Xác nhận/Từ chối: dòng đơn biến mất khỏi danh sách sau ~600ms fade** (không giữ lại ở
   trạng thái "đã xử lý, mờ đi" lâu dài) — vì API GET chỉ trả đơn `WAITING`, giữ lại sẽ cần state riêng
   phía client phức tạp hơn cho lợi ích nhỏ.
3. **Panel chọn lý do từ chối: inline expand trong dòng đơn, không phải modal** — giữ toàn bộ danh
   sách hàng chờ vẫn nhìn thấy được trong lúc xử lý 1 đơn, đúng tinh thần "tốc độ" của trang này.
4. **Stepper 5 mốc luôn NGANG kể cả ở 375px**, không chuyển dọc — khớp UX quen thuộc app giao đồ ăn,
   và tiết kiệm chiều cao màn hình cho danh sách món bên dưới.

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
