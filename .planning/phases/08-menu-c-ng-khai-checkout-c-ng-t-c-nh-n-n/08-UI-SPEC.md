---
phase: 8
slug: menu-cong-khai-checkout-cong-tac-nhan-don
status: draft
shadcn_initialized: false
preset: none
created: 2026-07-30
---

# Phase 8 — UI Design Contract

> Hợp đồng thị giác và tương tác cho: Menu công khai, Giỏ hàng/Checkout 2 bước, công tắc ON/OFF nhận đơn,
> và toàn bộ trạng thái lỗi/chặn lạm dụng phía khách. Sinh bởi `gsd-ui-researcher`, xác minh bởi `gsd-ui-checker`.
>
> **Nguồn sự thật khi có xung đột:** `apps/shop/src/styles/tokens.css` (C-UI-01) > `apps/shop/DESIGN.md` >
> file này > §8-bis trong `docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md` (bản gốc, đã có 3 màu + 1 số cột lệch
> vì lý do WCAG/ref-mobile, xem `OVERRIDE-DEBT.md` OD-04/OD-05).

---

## Design System

| Property | Value |
|----------|-------|
| Tool | **none** — không dùng shadcn/Tailwind (xem lý do dưới) |
| Preset | không áp dụng |
| Component library | không — React thuần + object style (`CSSProperties`) hoặc CSS module, đọc token qua `var(--...)`, theo đúng khuôn mẫu `Wordmark.tsx` đã có từ phase 7 |
| Icon library | **không dùng package icon** (không `lucide-react`, không `react-icons`) — SVG tự vẽ tay, `stroke="currentColor"`, stroke-width 1.5–2px, kích thước mặc định 20px (24px ở header). Lý do: nhất quán triết lý tự-host của dự án (font đã tự host, không gọi CDN) và tránh thêm dependency giữa milestone |
| Font | `Baloo 2` (700/800, display) + `Be Vietnam Pro` (400/600, body) — đã tự host tại `apps/shop/public/fonts/`, khai báo ở `fonts.css`. Không đổi, không thêm font |

**Vì sao "Tool: none" thay vì chạy shadcn init gate:** `apps/shop` không có `components.json`, không có Tailwind config trong repo, và đã có một hệ thống thiết kế thủ công hoàn chỉnh từ phase 7 (`tokens.css` + `DESIGN.md`, được `impeccable detect` xác minh). Thêm shadcn/Tailwind giữa milestone sẽ mâu thuẫn với `Wordmark.tsx` (đang dùng `CSSProperties` object đọc `var(--...)`) và buộc dựng lại toàn bộ layer CSS. Giữ nguyên mẫu hiện có — **đây là quyết định tiếp nối, không phải né hỏi**. Ghi trong "Giả định cần xác nhận" cuối file để chủ dự án biết có thể yêu cầu đổi.

---

## Spacing Scale

Nguồn: `tokens.css` `--sp-1..--sp-16`. Đã có **nhiều hơn** 7 bậc chuẩn của template vì đây là hệ thống đã khoá từ phase 7 — không phải bậc tự chọn mới.

| Token | Giá trị | Dùng cho |
|-------|--------|----------|
| `--sp-1` | 4px | Khoảng cách icon-chữ, gap rất nhỏ |
| `--sp-2` | 8px | Khoảng cách phần tử compact (badge, chip) |
| `--sp-3` | 12px | **Sàn padding trong card** (`--pad-card-tight`) |
| `--sp-4` | 16px | Mặc định giữa phần tử, `--pad-card`, `--gutter` (lề mobile) |
| `--sp-5` | 20px | Khoảng giữa card trong lưới món |
| `--sp-6` | 24px | Padding section |
| `--sp-8` | 32px | `--gutter-lg` (lề desktop), khoảng cách khối |
| `--sp-10` | 40px | Khoảng nghỉ vừa |
| `--sp-12` | 48px | Khoảng nghỉ giữa khối lớn |
| `--sp-16` | 64px | Khoảng cách page-level |

Exceptions (đã khoá trong tokens.css, áp dụng đúng cho phase 8):
- `--tap-min: 44px` — sàn Apple HIG cho nút `+` thêm món, nút tăng/giảm số lượng trong giỏ hàng, mọi nút bấm bằng ngón tay trên mobile.
- `--sticky-cta-h: 72px` — chiều cao thanh CTA dính đáy ("TIẾP TỤC" / "ĐẶT HÀNG" trên mobile); trang phải chừa `padding-bottom` bằng giá trị này + `--safe-bottom`.
- `--safe-bottom` / `--safe-top` — `env(safe-area-inset-*)`, bắt buộc cho thanh dính đáy trên iPhone có notch/home-indicator.

---

## Typography

Tokens.css đã khoá **9 bậc cỡ chữ** và **5 bậc độ đậm** từ phase 7 (không phải chọn mới cho phase 8) — vượt hướng dẫn chung "3–4 cỡ / 2 độ đậm" của template vì đây là hệ thống kế thừa đã qua kiểm `impeccable detect`. 4 dòng bắt buộc của template ứng với vai trò nổi bật nhất của phase 8:

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Body | 16px (`--fs-base`) | 400 (`--fw-normal`) | 1.55 (`--lh-normal`) |
| Label (nút, nhãn IN HOA) | 14px (`--fs-sm`) | 600 (`--fw-semibold`), `letter-spacing: 0.06em` | 1.2 (`--lh-tight`) |
| Heading (tiêu đề khối: "GIỎ HÀNG CỦA BẠN", card title) | 20px (`--fs-lg`) | 700 (`--fw-bold`) | 1.35 (`--lh-snug`) |
| Display (giá món — phần tử "kêu" nhất trang) | 24px (`--fs-xl`) | 800 (`--fw-heavy`), font `--font-display` | 1.2 (`--lh-tight`) |

Bảng đầy đủ các cỡ khác dùng trong phase 8 (tham chiếu, không lặp lại ở trên):

| Size | Dùng ở đâu (phase 8) |
|------|----------------------|
| 12px (`--fs-caption`) | Mô tả meta phụ, nhãn badge "Bán chạy"/"Hết hàng", dòng disclosure "Thông tin của bạn chỉ dùng để giao đơn này." |
| 18px (`--fs-md`) | Tên món trên card (font `--font-display`, weight 700, `--lh-snug`) |
| 30px (`--fs-2xl`) | Tổng cộng (`Tổng cộng`) ở card tổng tiền giỏ hàng/checkout |

Input **luôn 16px** (`--fs-base`) — không được nhỏ hơn, kể cả input SĐT/địa chỉ, để tránh Safari iOS tự zoom.

---

## Color

Tất cả giá trị dưới đây **tham chiếu token**, không hardcode hex (Quyết định khoá #1). Số hex trong ngoặc chỉ để tham khảo khi đọc — code phải viết `var(--...)`.

| Role | Token | Usage |
|------|-------|-------|
| Dominant (60%) | `--bg-page` (`#fdf7ee`) + `--bg-surface` (`#fffdfa`) | Nền trang, nền card món/card tổng tiền/input |
| Secondary (30%) | `--bg-wood` (`#6b4423`) cho khối đậm (plaque logo, có thể dùng cho khối header trang tracking phase 9); `--wood-100`/`--border-subtle` cho nền dải danh mục và viền card | Card, dải danh mục, khối tương phản |
| Accent (10%) | `--brand-500` / `--brand-600` / `--brand-700` (đỏ ớt) | **CHỈ** dùng cho: giá món, viền + chữ tab/danh mục đang chọn, nút CTA chính ("TIẾP TỤC", "ĐẶT HÀNG", nút `+` thêm món), badge số lượng giỏ hàng, link "+ THÊM MÓN", vòng tròn stepper bước đang active, viền input khi focus |
| Destructive | `--danger-600` (`#b4231d`) trên nền `--danger-100` | **CHỈ** dùng cho: banner lỗi submit (409/rate-limit/blacklist), nhãn "Hết hàng", viền input lỗi validation. **Không** dùng để xoá dòng giỏ hàng (không có thao tác phá huỷ thật trong phase 8, xem Copywriting) |

**Accent reserved for (danh sách đóng, không được mở rộng tuỳ tiện):** giá tiền · nút CTA chính (TIẾP TỤC/ĐẶT HÀNG/nút `+`) · tab & category tile đang chọn · badge số món trong giỏ · link "+ THÊM MÓN" · vòng tròn bước đang active của stepper · viền input focus.

Màu phụ khác đã khoá trong tokens.css, dùng đúng vai trò được gán — **không đổi vai trò**:
- `--wood-400`/`--wood-500` — CHỈ làm nền/trang trí (nền badge "Bán chạy", dải trang trí). Tuyệt đối không dùng cho chữ (2.02–2.43:1, fail AA). Chữ trên nền `wood-500` phải dùng `--text-strong` (đã tính: 6.30:1 ✓AA — xem "Bảng tương phản đã tính" bên dưới).
- `--herb-600` — nhãn "còn hàng"/tươi, tick xác nhận (không dùng làm màu nút chính).
- `--warn-600`/`--warn-100` — banner "ngoài giờ mở cửa", banner "chờ duyệt" (không dùng ở phase 8 nhiều, chủ yếu phase 9).
- `--info-600`/`--info-100` — banner "quán vừa cập nhật đơn" (chủ yếu phase 9, phase 8 chỉ cần route tồn tại).
- `--cat-1`..`--cat-7` — nền tile danh mục, gán theo index nhóm, lặp lại sau 7 nhóm.

### Bảng tương phản đã tính riêng cho phase 8 (không có sẵn trong tokens.css)

| Cặp | Tỉ lệ (WCAG 2.1) | Kết luận |
|-----|------------------|----------|
| `--text-strong` (`#2a1d14`) trên `--wood-500` (`#d9922b`) — chữ badge "Bán chạy" | **6.30:1** | ✓ AA (kể cả chữ thường) |

---

## Copywriting Contract

| Element | Copy |
|---------|------|
| Primary CTA — bước 1 → 2 | **"TIẾP TỤC"** (IN HOA, full-width, dính đáy trên mobile) |
| Primary CTA — gửi đơn (bước 2) | **"ĐẶT HÀNG"** (IN HOA — không dùng "Thanh toán"/"Xác nhận" vì không thu tiền online, M2.D-58) |
| CTA thêm món | Icon `+` không chữ, `aria-label="Thêm {tên món} vào giỏ"` |
| Empty state heading (giỏ hàng rỗng) | **"Giỏ hàng đang trống"** |
| Empty state body | **"Xem menu và thêm món bạn thích nhé"** + nút **"Xem menu"** → `/` |
| Error — `ONLINE_ORDERING_DISABLED` | *"Quán vừa tắt nhận đơn online. {off_reason nếu có, else 'Vui lòng gọi {store_phone} để đặt trực tiếp.'}"* + nút gọi 1 chạm |
| Error — `STORE_CLOSED` | *"Quán đang ngoài giờ mở cửa hôm nay. Gọi {store_phone} nếu cần hỗ trợ."* |
| Error — `PHONE_BLACKLISTED` | *"Không thể gửi đơn với số điện thoại này lúc này. Vui lòng gọi {store_phone} để được hỗ trợ."* (giọng trung tính, **không** nói "bị chặn"/"blacklist") |
| Error — `TOO_MANY_REQUESTS` | *"Bạn thao tác hơi nhanh, vui lòng thử lại sau ít phút."* |
| Error — `ORDER_ALREADY_OPEN_FOR_PHONE` | *"Số điện thoại này đang có 1 đơn chưa xử lý xong. Vui lòng chờ quán xác nhận, hoặc gọi {store_phone}."* (+ link "Xem đơn đang chờ" nếu tìm thấy token gần nhất trong localStorage) |
| Error — `MENU_ITEM_UNAVAILABLE` | *"Một vài món trong giỏ hàng vừa hết. Vui lòng quay lại giỏ hàng để cập nhật."* + nút "Về giỏ hàng" |
| Error — `NO_TABLE_AVAILABLE` | *"Có lỗi hệ thống, vui lòng thử lại hoặc gọi {store_phone}."* (phòng hờ — về lý thuyết không nên xảy ra vì M2.D-05 tự tạo bàn) |
| Error — mạng/không rõ | *"Không gửi được đơn, vui lòng thử lại."* + nút "Thử lại" |
| Phí ship — có toạ độ, trong `free_ship_km` | *"Cách quán khoảng {distance_km} km — Miễn phí ship"* |
| Phí ship — có toạ độ, ngoài `free_ship_km` | *"Cách quán khoảng {distance_km} km — Phí ship do quán xác nhận khi gọi lại"* |
| Phí ship — chưa có toạ độ | *"Trong {free_ship_km} km miễn phí, xa hơn có phụ phí — phí cuối do quán xác nhận khi gọi lại"* |
| Phí ship — chưa chọn PICKUP/DELIVERY (đang ở bước 1) | *"Chọn phương thức nhận hàng ở bước sau để xem phí ship"* |
| Disclosure PII (thay checkbox Lotteria) | *"Thông tin của bạn chỉ dùng để giao đơn này."* (fs-caption, `--text-muted`, dưới nút submit) |
| Banner OFF (menu + checkout) | Tiêu đề *"Quán tạm ngưng nhận đơn online"* + dòng phụ *"{off_reason || mặc định} — gọi {store_phone} để đặt trực tiếp"* |
| Destructive confirmation | **Không có** thao tác phá huỷ thật trong phạm vi phase 8. Bấm `-` về 0 ở giỏ hàng xoá dòng **không cần xác nhận** — dữ liệu chưa gửi server, thêm lại được ngay lập tức |

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | không dùng | không áp dụng (Tool: none) |
| third-party | không dùng | không áp dụng |

---

## Phần bổ sung — Kiến trúc màn hình (dành cho planner/executor)

> Template chuẩn của GSD chỉ yêu cầu 6 mục trên. Các mục dưới đây bổ sung để executor có đủ chi tiết
> triển khai, theo đúng tinh thần "prescriptive, not exploratory" của vai trò UI researcher.

### AppShell & Router (việc đầu phase 8)

- Thay `<main>` tĩnh trong `apps/shop/src/main.tsx` bằng `BrowserRouter`. Routes:
  `/` MenuPage · `/cart` CartPage · `/checkout` CheckoutPage · `/o/:token` OrderTrackPage · `/history` HistoryPage.
- `AppShell` bọc `<Outlet/>` bằng `<Header/>` chung. **2 biến thể header dựng bằng CSS media query**
  (2 khối DOM, ẩn/hiện qua `display:none` ở breakpoint ~768px) — **không** dùng `useMediaQuery`/JS resize
  listener, để tránh nhấp nháy giữa 2 layout lúc mount (SPA thuần CSR, không SSR nên không có nguy cơ
  hydration mismatch, nhưng vẫn ưu tiên CSS-only cho đơn giản và không tốn JS).
- Xoá `BrandPreview.tsx` khỏi điểm mount khi router thật đã chạy (giữ file để tham khảo màu nếu cần, không import ở `main.tsx`).
- `/history` và `/o/:token` trong phạm vi phase 8 **chỉ cần tồn tại và không lỗi 404** — nội dung đầy đủ
  (danh sách đơn thật, % tiến độ, banner cập nhật) là REQ-O, thuộc **phase 9 UI-SPEC**. Phase 8 chỉ cần:
  - `/o/:token` hiện được 1 màn xác nhận tối giản ngay sau khi submit thành công (xem mục Checkout bên dưới) — để luồng không cụt.
  - `/history` hiện empty state cơ bản nếu không tìm thấy đơn nào theo `customer_token` (nội dung đầy đủ để phase 9 làm tiếp).

### Header — biến thể Desktop

Sticky (`--z-sticky-header: 100`, `--shadow-sticky` khi đã cuộn). Trái: `<Wordmark variant="bare"/>`.
Giữa: nav ngang IN HOA (`Trang chủ`, `Đơn của tôi` → `/history`) — **bỏ hẳn icon tài khoản của Lotteria**
(không có login, M2.D-09). Tab đang xem: gạch chân đỏ + chữ `--brand-600`. Phải: ô tìm kiếm inline (xem
mục Tìm kiếm) + icon giỏ hàng có badge tròn (`--r-badge`, nền `--brand-600`, chữ trắng, tối thiểu 18px)
hiện số món, bấm vào → `/cart`.

### Header — biến thể Mobile

Sticky, cùng z-index. Trái: `<Wordmark variant="bare" size="var(--fs-md)"/>`. Phải: icon kính lúp (mở
overlay tìm kiếm) → icon giỏ hàng + badge (luôn hiện, không giấu trong hamburger vì là điểm bấm nhiều) →
hamburger (mở overlay nav dọc chứa "Trang chủ" / "Đơn của tôi").

### Dải danh mục (category rail)

Sticky ngay dưới header (`--z-category-rail: 90`), cuộn ngang. Mỗi tile: ảnh vuông bo `--r-category` (16px)
trên nền `--cat-N` (gán theo index nhóm, lặp lại sau 7 nhóm), tên nhóm dưới ảnh (`--fs-sm`, `--fw-medium`).
Đang chọn: viền `--border-brand` (2px) + chữ `--brand-600`. Nhóm chưa có ảnh → dùng ảnh món bán chạy nhất
của nhóm làm đại diện (theo §8-bis mục 2).

**Mobile:** chỉ hiện ~3.5 tile cùng lúc + **dot pagination** dưới rail (6–8px, dot active `--brand-500`,
dot thường `--border-default`) — theo ảnh ref mobile thật.

### Banner thông báo (component dùng chung — `banner-notice`)

Nằm **dưới** dải danh mục (không sticky, cuộn theo trang), full width trong `--content-max`. Style theo
`components.banner-notice` trong `DESIGN.md`: nền `--brand-100`, icon trái, tiêu đề đậm + dòng phụ
`--text-muted`. Tái dùng đúng 1 component cho 2 tình huống:
- OFF thủ công (có/không `off_reason`) — copy ở bảng Copywriting.
- Ngoài giờ mở cửa tự động (`is_open_now: false`) — copy tương tự, nhấn mạnh giờ mở cửa hôm nay.

Khi banner hiện: nút `+` thêm món **vẫn bấm được** (khách vẫn xây giỏ hàng để gọi lại sau) — chỉ **nút
submit cuối ở bước 2 checkout** bị khoá (diễn giải hẹp của "chỉ khoá nút đặt hàng", M2.D-26/27 — xem Giả
định #3 cuối file).

### Ô tìm kiếm (REQ-I)

Không có trong ảnh ref Lotteria đã cung cấp — tự thiết kế theo tinh thần tokens.css:
- Desktop: input inline trong header, đặt trước icon giỏ hàng, placeholder "Tìm món...", rộng ~240px,
  `--r-input`, viền `--border-default`, focus → viền `--border-brand` + `--focus-ring`.
- Mobile: icon kính lúp mở overlay full-width phủ dưới header (không phủ dải danh mục), input tự động
  focus, phím "Huỷ" đóng overlay.
- Input luôn 16px (`--fs-base`) theo sàn chung.

### Giỏ hàng nổi (REQ-I — "giỏ hàng nổi hiện tổng tiền", G-3)

- **Mobile:** thanh dính đáy full-width khi giỏ có ≥1 món (`--z-floating-cart: 200`, `--shadow-float`),
  nội dung "{N} món · {tổng tiền}" bên trái + "Xem giỏ hàng →" bên phải, nền `--brand-600`, chữ trắng.
  Ẩn hoàn toàn khi giỏ rỗng (không hiện thanh rỗng).
- **Desktop:** không cần thanh nổi riêng vì header luôn hiện — badge số lượng trên icon giỏ hàng đã đủ
  đáp ứng "luôn thấy được giỏ hàng"; tổng tiền hiện khi hover/focus vào icon giỏ hàng (tooltip nhỏ) hoặc
  khi mở dropdown mini-cart (tuỳ chọn triển khai, không bắt buộc).

### Trang Menu (`/`)

Lưới món: `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))`, **không media query**
(CONFLICT-DESIGN-01 đã chốt, OD-05) — ~360px → 1 cột · ~768px → 2 cột · ~1200px → 4 cột.

Card món (đúng `components.card-item` trong `DESIGN.md`):
- Nền `--bg-surface`, viền `--border-subtle` 1px, bo `--r-card` (12px), padding `--pad-card` (16px), **không đổ bóng**.
- Ảnh: full chiều rộng card, `aspect-ratio` cố định (khuyến nghị 4:3) để không giật layout khi tải.
- Tên món: `--fs-md` (18px) / `--fw-bold` (700) / font `--font-display` / `--lh-snug`, tối đa 2 dòng (`-webkit-line-clamp: 2`).
- Mô tả: `--fs-sm` (14px) / `--text-muted`, tối đa 2 dòng.
- Giá + nút `+`: **cùng một hàng** (bắt buộc vì card đủ rộng ở mọi breakpoint nhờ 1-cột). Giá: `--fs-xl`
  (24px) / `--fw-heavy` (800) / `--text-price` (= `--brand-500`). Nút `+`: hình vuông `--tap-min` (44×44px),
  nền `--brand-600`, bo `--r-button` (8px), icon `+` trắng.
- Badge "Bán chạy": pill góc trên-trái ảnh, nền `--wood-500`, chữ `--text-strong` (6.30:1 ✓AA — xem bảng
  tương phản), `--fs-caption`, `--fw-semibold`, padding `--sp-1 --sp-2`. **Suy ra từ dữ liệu bán thật**,
  không phải gắn tay.
- Món hết hàng (`is_out_of_stock`): toàn bộ nội dung card `opacity: var(--opacity-out-of-stock)` (0.45),
  **trừ** 1 chip "Hết hàng" (nền `--bg-overlay`, chữ trắng, `opacity: 1`) đặt giữa ảnh để luôn đọc được.
  Nút `+` disable (`opacity: var(--opacity-disabled)`, `cursor: not-allowed`, `aria-disabled="true"`).
  **Không ẩn card** (M2.D-31).
- **Không** giá gạch ngang / combo / coupon / nhãn "Khuyến mãi" (quán chưa có khuyến mãi).

Skeleton loading: card giữ nguyên kích thước, nội dung thay bằng khối `--bg-sunken` pulse animation
(chỉ animate `opacity`, tôn trọng `prefers-reduced-motion`).

### Giỏ hàng (`/cart`) — Bước 1 "Giỏ hàng"

- Header thu gọn: logo + stepper 2 bước ngang (bước 1 filled `--brand-600` nền trắng chữ, bước 2 viền
  rỗng `--border-strong`). Mobile: co lên cùng hàng với logo, chữ `--fs-caption`.
- Tiêu đề "GIỎ HÀNG CỦA BẠN (N món)" + link "+ THÊM MÓN" (`--brand-600`, `--fs-sm`, `--fw-semibold`) → `/`.
- Danh sách dòng giỏ hàng: ảnh 56×56 bo `--r-card`, tên món (`--fs-base`/`--fw-semibold`/`--text-strong`),
  đơn giá (`--text-price-sm` = `--brand-600`), stepper số lượng (nút `-`/`+` `--tap-min` 44px), thành tiền
  dòng bold phải. Giảm về 0 → xoá dòng ngay, không hỏi xác nhận.
- Ô "Ghi chú đơn hàng": input kiểu gạch chân (border-bottom only), placeholder "Ví dụ: ít cay, giao giờ
  trưa...", map vào `customer_note` (tối đa 500 ký tự theo schema).
- **Bỏ hẳn** card "Tùy chọn" và checkbox "Thu thập thông tin cá nhân" của Lotteria (đã chốt).
- Card tổng tiền: `Tạm tính` = tổng dòng giỏ hàng. `Phí giao hàng`: hiện copy "Chọn phương thức nhận hàng
  ở bước sau để xem phí ship" (chưa biết PICKUP/DELIVERY ở bước này — xem Giả định #1). `Tổng cộng` = tạm
  tính (chưa gồm ship). Nút "TIẾP TỤC" → `/checkout`, dính đáy full-width bo góc 0 trên mobile
  (`--sticky-cta-h`, `--safe-bottom`), nằm trong card trên desktop.
- Empty state (0 món): ảnh minh hoạ SVG đơn giản (tông `--brand-100`/`--wood-100`) + heading "Giỏ hàng
  đang trống" + body "Xem menu và thêm món bạn thích nhé" + nút "Xem menu" → `/`. Ẩn ô ghi chú, card tổng
  tiền, và nút "TIẾP TỤC" khi giỏ rỗng.

### Checkout (`/checkout`) — Bước 2 "Thông tin nhận hàng"

> **Đổi tên có chủ đích** khỏi "Thanh toán" của Lotteria (không thu tiền online, M2.D-58). Xem Giả định #1
> về việc card "Nhận hàng" chuyển hẳn sang bước này thay vì ở bước 1 như bố cục gốc Lotteria.

- Card "Nhận hàng": segmented control 2 lựa chọn **"Đến lấy tại quán"** (PICKUP) / **"Giao tận nơi"**
  (DELIVERY) — nút pill, đang chọn nền `--brand-600` chữ trắng, còn lại nền `--bg-surface` viền
  `--border-default`.
  - Input "Họ và tên", "Số điện thoại" (`type="tel"`, `inputmode="tel"`) — luôn hiện.
  - **Chỉ DELIVERY** hiện thêm: input "Địa chỉ giao hàng", nút phụ "Chia sẻ vị trí của bạn" (icon ghim vị
    trí, viền `--brand-600` chữ `--brand-600`, Geolocation API), link phụ "Hoặc dán link Google Maps"
    (mở input ẩn). Sau khi có toạ độ: hiện dòng khoảng cách theo bảng Copywriting (M2.D-51).
  - Autofill từ `customer_token`: nếu có đơn trước đó lưu localStorage, điền sẵn tên/SĐT/địa chỉ — vẫn
    sửa được.
- Recap ghi chú đã nhập ở bước 1 (đọc, có link "Sửa" quay lại `/cart`).
- Card tổng tiền cập nhật `Phí giao hàng` theo copy đúng M2.D-51/52 (không bao giờ tự điền số tiền cụ thể
  khi ngoài vùng miễn phí). Nút chính "ĐẶT HÀNG" full-width — trong lúc gửi: disable + label "Đang gửi
  đơn..." kèm spinner nhỏ.
- Dòng disclosure dưới nút: "Thông tin của bạn chỉ dùng để giao đơn này." (`--fs-caption`, `--text-muted`).
- Mọi lỗi submit (409/rate-limit/…): banner inline phía trên nút (nền `--danger-100`, chữ `--danger-600`),
  copy theo bảng Copywriting, không rời trang — khách sửa và bấm lại được ngay.
- Thành công: redirect `/o/:token`.

### `/o/:token` — màn xác nhận tối giản (chỉ phần thuộc phase 8)

Ngay sau submit thành công: hiện "Đã gửi đơn thành công!" + mã đơn (rút gọn từ token hoặc mã đơn hiển thị
được) + "Quán sẽ xác nhận sớm nhất có thể" + nút "Xem trạng thái đơn" (nếu phase 9 đã có UI) hoặc giữ
nguyên tại chỗ. **Toàn bộ phần % tiến độ, 5 mốc, banner cập nhật đơn, nút gọi quán thuộc REQ-O → phase 9
UI-SPEC sẽ định nghĩa đầy đủ.**

---

## Giả định cần chủ dự án xác nhận

> Không có tool hỏi trực tiếp trong phiên này — các điểm dưới đây quyết theo tokens.css + §8-bis + design
> ref (nguồn sự thật), nhưng cần chủ dự án xác nhận trước khi executor thi công, vì đều là diễn giải hợp
> lý chứ không phải quyết định đã khoá bằng chữ.

1. **Card "Nhận hàng" (chọn PICKUP/DELIVERY + địa chỉ) chuyển hẳn sang bước 2 `/checkout`**, không nằm ở
   cột phải bước 1 `/cart` như bố cục gốc Lotteria (ảnh ref desktop cho thấy card này nằm ngay ở trang giỏ
   hàng). Lý do: roadmap mô tả rõ "chọn PICKUP/DELIVERY" thuộc bước 2, và bước 2 đã đổi tên thành "Thông
   tin nhận hàng" — gộp toàn bộ thông tin người nhận vào đúng bước mang tên đó là hợp lý hơn.
2. **Không dùng package icon** (SVG tự vẽ tay) để giữ triết lý tự-host, tránh dependency mới giữa milestone.
3. Diễn giải hẹp cho M2.D-26/27: nút `+` thêm món **vẫn bấm được** khi công tắc OFF/ngoài giờ, **chỉ** nút
   "ĐẶT HÀNG" cuối bước 2 bị khoá. Nếu chủ quán muốn khoá cả `+` ngay từ trang menu khi OFF, cần điều
   chỉnh mục "Banner thông báo" ở trên.
4. Giọng văn copy cho lỗi `PHONE_BLACKLISTED` cố tình trung tính (không nói "bị chặn") để tránh khiêu
   khích khách spam — cần chủ quán duyệt tông giọng.
5. Nhãn nút submit cuối chọn **"ĐẶT HÀNG"** (thay vì "GỬI ĐƠN"/"XÁC NHẬN ĐẶT HÀNG").
6. Nhãn hiển thị PICKUP/DELIVERY: **"Đến lấy tại quán"** / **"Giao tận nơi"**.
7. Ô tìm kiếm (REQ-I) không có trong ảnh ref — tự thiết kế icon kính lúp + overlay (mobile) / input inline
   (desktop) theo mục "Ô tìm kiếm" ở trên.
8. AppShell 2 biến thể header dựng bằng **CSS media query** (không JS breakpoint hook) — quyết định kỹ
   thuật, không ảnh hưởng hình ảnh cuối cùng nhưng ảnh hưởng cách executor viết code.
9. Giỏ hàng nổi: **mobile** = thanh dính đáy hiện tổng tiền; **desktop** = chỉ badge số lượng trên icon
   giỏ hàng ở header (không có thanh nổi riêng, vì header luôn hiện sẵn đã đáp ứng "luôn thấy giỏ hàng").
10. "Tool: none" cho shadcn/Tailwind — tiếp nối mẫu `Wordmark.tsx` đã có, không mở gate hỏi lại vì đã có
    hệ thống thiết kế hoàn chỉnh từ phase 7.

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
