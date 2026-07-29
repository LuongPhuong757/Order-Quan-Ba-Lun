---
name: Quán Bà Lùn — Trang khách
description: Trang đặt hàng online, mobile-first. Đỏ coral trên nền hồng rất nhạt, chữ bo tròn ấm cho tên món và giá. Ảnh món là nhân vật chính, chrome lùi lại.

# NGUỒN SỰ THẬT là src/styles/tokens.css. Khối frontmatter này là bản xuất
# song song để bộ dò `impeccable detect` đối chiếu code với design system.
# Sửa tokens.css thì phải sửa cả đây, nếu không validator sẽ báo lệch.
#
# Đặt DESIGN.md ở apps/shop/ (KHÔNG ở gốc repo) là có chủ đích: bộ dò đi ngược
# lên từ file đang quét và dừng ở thư mục đầu tiên có DESIGN.md, nên phạm vi
# design system này chỉ áp cho apps/shop. apps/web và apps/api không bị ảnh hưởng.
colors:
  # Thương hiệu — CHỜ CHỐT (M2.D-71). Đang dùng tạm đỏ coral của Lotteria.
  brand-500: "#e4453a"       # viền, giá ≥24px đậm
  brand-600: "#cc3529"       # nút, link đỏ nhỏ, tab active (đạt AA)
  brand-700: "#a82419"       # hover / active
  brand-100: "#ffe9e7"       # nền badge, nền banner thông báo
  brand-050: "#fff4f3"

  # Nền & mặt phẳng
  bg-page: "#fff9f8"
  bg-surface: "#ffffff"
  bg-sunken: "#f7f2f1"

  # Chữ
  text-strong: "#1c1917"
  text-body: "#33302e"
  text-muted: "#726865"      # thay #888 của §8-bis vì #888 không đạt AA
  text-faint: "#8f8481"      # chỉ cho chữ lớn đậm / icon

  # Viền
  border-subtle: "#eeeae9"
  border-default: "#ded8d6"
  border-strong: "#b8afac"

  # Trạng thái
  ok-600: "#157f5f"
  ok-100: "#e3f7ef"
  warn-600: "#96590a"
  warn-100: "#fdf1dc"
  danger-600: "#b4231d"
  danger-100: "#fde9e7"
  info-600: "#1f5f9e"
  info-100: "#e6f0fa"

  # Pastel nền ảnh danh mục — gán theo index nhóm, lặp lại sau 7 nhóm
  cat-1: "#f3e8ff"
  cat-2: "#e0f2fe"
  cat-3: "#fce7f3"
  cat-4: "#d1fae5"
  cat-5: "#fef3c7"
  cat-6: "#ffedd5"
  cat-7: "#faf5eb"

typography:
  scale:
    # Thang cỡ chữ đóng. Mọi font-size trong apps/shop phải rơi vào một bậc
    # dưới đây (bộ dò cho sai số ±0.5px). Thêm bậc là quyết định thiết kế,
    # không phải tiện tay.
    #
    # SÀN 12px: dưới mức đó khách trên điện thoại không đọc nổi.
    # Input BẮT BUỘC 16px: dưới 16px Safari iOS tự zoom khi bấm vào ô.
    "12": "0.75rem"      # meta phụ, dấu thời gian
    "14": "0.875rem"     # nhãn, badge, mô tả ngắn, nhãn nút
    "16": "1rem"         # body, input
    "18": "1.125rem"     # tên món
    "20": "1.25rem"      # tiêu đề khối
    "24": "1.5rem"       # giá món
    "30": "1.875rem"     # tổng tiền ở giỏ hàng
    "36": "2.25rem"      # số phần trăm ở trang theo dõi đơn
    "48": "3rem"         # phần trăm cỡ lớn trên desktop
  display:
    # Baloo 2 — bo tròn, ấm, hợp hàng ăn. Dùng cho tên món, giá, tiêu đề.
    fontFamily: "Baloo 2, Be Vietnam Pro, Segoe UI, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 800
    letterSpacing: "-0.01em"
    lineHeight: 1.2
  title:
    fontFamily: "Baloo 2, Be Vietnam Pro, Segoe UI, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.35
  body:
    # Be Vietnam Pro — nhà chữ Việt làm, bộ dấu chuẩn, đọc tốt ở cỡ nhỏ.
    fontFamily: "Be Vietnam Pro, Segoe UI, Helvetica Neue, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    # Nhãn IN HOA: nav desktop, nút "TIẾP TỤC"
    fontFamily: "Be Vietnam Pro, Segoe UI, Helvetica Neue, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    letterSpacing: "0.06em"
  mono:
    # Mã đơn, số điện thoại — cần chữ số đều cột
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.875rem"
    fontWeight: 500

rounded:
  none: "0"
  sm: "4px"
  button: "8px"
  input: "8px"
  card: "12px"
  category: "16px"
  sheet: "20px"
  pill: "999px"

spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  "2xl": "32px"
  "3xl": "48px"
  "4xl": "64px"

components:
  button-primary:
    backgroundColor: "{colors.brand-600}"
    textColor: "#ffffff"
    typography: "{typography.label}"
    rounded: "{rounded.button}"
    padding: "14px 20px"
  button-primary-hover:
    backgroundColor: "{colors.brand-700}"
    textColor: "#ffffff"
  button-add-item:
    backgroundColor: "{colors.brand-600}"
    textColor: "#ffffff"
    rounded: "{rounded.button}"
    padding: "0"
  input-text:
    backgroundColor: "{colors.bg-surface}"
    textColor: "{colors.text-strong}"
    borderColor: "{colors.border-default}"
    rounded: "{rounded.input}"
    padding: "12px 14px"
  card-item:
    backgroundColor: "{colors.bg-surface}"
    textColor: "{colors.text-strong}"
    borderColor: "{colors.border-subtle}"
    rounded: "{rounded.card}"
    padding: "16px"
  category-tile:
    backgroundColor: "{colors.cat-1}"
    textColor: "{colors.text-strong}"
    rounded: "{rounded.category}"
    padding: "12px"
  category-tile-active:
    borderColor: "{colors.brand-500}"
    textColor: "{colors.brand-600}"
  banner-notice:
    backgroundColor: "{colors.brand-100}"
    textColor: "{colors.text-strong}"
    rounded: "{rounded.card}"
    padding: "12px 16px"
---

# Design system — trang khách Quán Bà Lùn

Nguồn: **§8-bis** trong `.vg/MILESTONE-02-ONLINE-ORDERING-SPEC.md`, rút từ ảnh
tham chiếu `lotteria.vn`. File token thật: `src/styles/tokens.css`.

## 1. Bối cảnh dùng

Khách gần như **100% vào bằng điện thoại**, phần lớn đang đói và đang ở ngoài
đường, mạng 3G/4G. Mọi quyết định thiết kế phải trả lời được: *thao tác này
bằng một ngón tay, dưới nắng, trong 30 giây, có làm được không?*

Suy ra:

- Mobile-first thật sự — desktop là bản mở rộng, không phải bản gốc thu nhỏ.
- Vùng bấm sàn **44px**. Nút `+` thêm món và nút tăng/giảm số lượng là hai chỗ
  bấm nhiều nhất, không được nhỏ hơn.
- Nút hành động chính **dính đáy màn hình**, chừa `env(safe-area-inset-bottom)`
  cho thanh gạt iPhone.
- Ảnh món phải có `width`/`height` hoặc `aspect-ratio` để trang không nhảy khi
  ảnh tải xong.

## 2. Màu

Đỏ coral là màu duy nhất được phép "kêu". Nó dành cho **giá, nút, tab đang
xem, badge số món** — hết. Nếu mọi thứ đều đỏ thì không còn gì dẫn mắt.

Nền hồng rất nhạt `bg-page` giữ cho trang ấm mà không tranh với ảnh món.
Card món dùng **nền trắng + viền xám rất nhạt**, không đổ bóng — theo §8-bis.

Thang đỏ có 3 bậc vì một bậc không đủ:

| Bậc | Dùng ở đâu | Vì sao |
|---|---|---|
| `brand-500` `#e4453a` | viền, giá ≥24px đậm | Màu chữ ký. Tương phản 3.87:1 — chỉ đạt với chữ lớn |
| `brand-600` `#cc3529` | nút, link đỏ nhỏ, tab active | Trắng trên nó 5.11:1, nó trên nền 4.91:1 — **đạt AA cả hai chiều** |
| `brand-700` `#a82419` | hover, đang bấm | Đủ tối để thấy rõ khác biệt |

### Ba chỗ §8-bis phải sửa vì không đạt WCAG AA

Bản đặc tả gốc lấy màu trực tiếp từ ảnh Lotteria nên vướng 3 lỗi tương phản:

1. `#888` cho mô tả món = **3.40:1** — cần 4.5:1. Đã nâng lên `#726865` (5.19:1).
2. `#E4453A` cho chữ đỏ nhỏ = **3.87:1** — cần 4.5:1. Chữ nhỏ chuyển sang `brand-600`.
3. Chữ trắng trên nút `#E4453A` = **4.03:1** — cần 4.5:1. Nút chuyển sang `brand-600`.

Đây không phải chuyện làm cho đẹp: khách lớn tuổi đọc menu ngoài trời sẽ không
thấy nổi chữ xám nhạt trên nền hồng.

### Pastel danh mục

Bảy màu `cat-1..7` gán theo index nhóm trong `menu_groups`, lặp lại sau nhóm
thứ 7. Cả bảy đều đạt ≥14.8:1 với `text-strong` nên tên nhóm luôn đọc được dù
rơi vào màu nào.

## 3. Chữ

Hai họ font, mỗi họ một việc:

- **Baloo 2** — tên món, giá, tiêu đề. Bo tròn, ấm, gợi cảm giác đồ ăn.
- **Be Vietnam Pro** — body, nhãn, form. Do nhà chữ Việt làm, dấu tiếng Việt
  đặt đúng chỗ (nhiều font phương Tây đặt dấu chồng lên nhau ở chữ "ệ", "ỡ").

**Tự host `.woff2`** trong `public/fonts/`, subset `latin` + `vietnamese`.
Không gọi Google Fonts CDN: chậm và bị chặn thất thường ở mạng VN.

Không dùng `system-ui`, `Inter`, `Arial` làm font chính — đó là mặc định của
giao diện do AI sinh, trang nào cũng giống nhau.

## 4. Nên và không nên

### Nên

- Ảnh món lớn, chiếm phần lớn card. Đây là thứ khách quyết định mua.
- Món hết hàng: **làm mờ `0.45` + nhãn "Hết hàng" + nút `+` disable** (M2.D-31).
  Không ẩn — khách cần biết quán có món đó, hôm khác quay lại.
- Chỉ animate `transform` và `opacity`.
- Giỏ hàng nổi luôn hiện **tổng tiền**, không chỉ số món (G-3).
- Trạng thái rỗng có hình minh hoạ + một câu dẫn hành động.

### Không nên

- **Không** card lồng trong card. Card món đã là card, đừng bọc thêm khung.
- **Không** viền dày một bên card để trang trí. Nếu cần phân biệt trạng thái
  thì dùng badge có chữ — khách không đoán được ý nghĩa của một vạch màu.
- **Không** ô vuông bo góc đựng icon đặt trên mỗi tiêu đề.
- **Không** gradient tím-sang-xanh, không chữ đổ gradient.
- **Không** chữ xám trên nền màu.
- **Không** easing nảy / đàn hồi.
- **Không** animate `width` / `height` / `padding` / `margin`.
- **Không** giá gạch ngang, combo, coupon, nhãn "Khuyến mãi" — quán chưa có
  khuyến mãi, bày ra là nói dối khách. Riêng **"Bán chạy"** thì tính được từ
  dữ liệu bán thật nên dùng được.
- **Không** tự điền số tiền phí giao hàng. Theo M2.D-51/52: trong
  `free_ship_km` thì ghi *"Miễn phí"*, ngoài vùng hoặc không có toạ độ thì ghi
  *"Quán xác nhận khi gọi lại"*.

## 5. Kiểm tra trước khi xong

```bash
npx --yes impeccable detect apps/shop           # quét mã nguồn
npx --yes impeccable detect http://localhost:5174   # quét lúc chạy thật
```

Bản quét lúc chạy thật bắt được thứ mã nguồn không thấy: chữ tràn khung khi
tên món dài, tương phản sau khi màu chồng nhau, chữ bị ảnh đè.

Trong luồng VGFlow, việc này chạy tự động ở `/vg:review` qua validator
`design-antipatterns` — xem `.claude/scripts/validators/verify-design-antipatterns.py`.
