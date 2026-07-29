# Design refs — lotteria.vn

Nguồn tham chiếu UI cho `apps/shop` (trang khách). Chủ quán chọn https://www.lotteria.vn làm mẫu.
Đặc tả rút ra ở đây là **nguồn để code**; token màu/kích thước vẫn lấy từ `apps/shop/src/styles/tokens.css` (C-UI-01).

## Ảnh đã cung cấp

| # | Màn hình | Viewport | Ngày | File |
|---|----------|----------|------|------|
| 1 | `lotteria.vn/category/set` — dải danh mục + banner + lưới món | Desktop | 2026-07-29 | `desktop-category-set-top.png` *(chưa lưu)* |
| 2 | `lotteria.vn/category/set` — lưới món kèm giá + nút `+` | Desktop | 2026-07-29 | `desktop-category-set-grid.png` *(chưa lưu)* |
| 3 | `lotteria.vn/cart` — giỏ hàng rỗng, 2 cột | Desktop | 2026-07-29 | `desktop-cart.png` *(chưa lưu)* |
| 4 | `lotteria.vn/cart` — giỏ hàng rỗng | **Mobile** | 2026-07-29 | `mobile-cart.png` *(chưa lưu)* |
| 5 | `lotteria.vn/category/set` — danh mục + banner + card món | **Mobile** | 2026-07-29 | `mobile-category-set.png` *(chưa lưu)* |

> **Cần anh làm:** lưu 5 file PNG vào đúng thư mục này với đúng tên ở cột File. Claude nhận ảnh qua chat nên
> không ghi được file binary; đặc tả bên dưới đã rút xong nên phase 8 không bị block chờ file.

## Vẫn còn thiếu

- Ảnh mobile của **trang chi tiết món** và **checkout bước 2** (desktop cũng chưa có)
- Trang chủ / banner (desktop + mobile)
- **Logo + màu thương hiệu Quán Bà Lùn** — đây là thứ duy nhất còn block re-skin. Màu hiện tại `#E4453A`
  vẫn là đỏ coral của Lotteria (spec:163, open item #6)

---

## Đặc tả rút từ ảnh

### Desktop — lưới món (#1, #2)

- Header dính: logo trái, nav ngang (`ĐẶT HÀNG` active có gạch chân đỏ), cụm icon vòng tròn bên phải
  (địa điểm / tài khoản / chuông / giỏ) + nút `DOWNLOAD APP` đỏ + chọn ngôn ngữ.
- Dải danh mục: 10 tile ảnh **vuông bo ~16px**, mỗi nhóm một **nền pastel khác nhau** (tím, xanh, hồng, xanh lá,
  hồng đậm, cam, đào…), tên nhóm dưới ảnh. Tile đang chọn: **viền đỏ + chữ đỏ**.
- Banner khuyến mãi: nền hồng rất nhạt, icon burger+drink bên trái, tiêu đề bold + dòng phụ nhỏ hơn.
- Lưới món **4 cột**. Card: viền `#EEE` bo ~12px, không shadow nặng; ảnh trên; tên bold đen;
  2 dòng mô tả thành phần màu xám; **giá đỏ ~24px bold**; giá gốc **gạch ngang** kèm icon tag bên dưới;
  **nút `+` vuông đỏ bo nhẹ** nằm phải cùng hàng với giá.
- FAB góc dưới: `MY COUPON` (trái), chat bot (phải).

### Desktop — giỏ hàng (#3)

- Stepper 2 bước ngang trên header: `Giỏ hàng` (active, tròn đặc đỏ) —— `Thanh toán` (tròn rỗng).
- **2 cột.** Trái: tiêu đề `GIỎ HÀNG CỦA BẠN (n Sản phẩm)` + link `+ THÊM MÓN ĂN` đỏ bên phải cùng hàng →
  vùng món (empty state: minh hoạ xe đẩy hồng + "Hiện tại không có món trong giỏ hàng") → card `Ghi chú đơn hàng`
  → card `Thu thập thông tin cá nhân`.
- Phải: card `Giao hàng đến / Cửa hàng` (có icon bút sửa) → card `Tùy chọn` (3 toggle đỏ) →
  card tổng tiền `Tạm tính` / `Phí giao hàng` / **`Tổng cộng`** → nút `TIẾP TỤC` đỏ full-width.

### Mobile — giỏ hàng (#4) ⚠️ khác desktop rõ rệt

- Stepper **co lên cùng hàng với logo**, chữ nhỏ.
- **1 cột, và thứ tự card ĐẢO so với desktop:** Giỏ hàng → `Ghi chú đơn hàng` → `Thu thập thông tin cá nhân`
  → `Giao hàng đến`. Trên desktop `Giao hàng đến` nằm **trên cùng** cột phải.
- Tiêu đề `GIỎ HÀNG CỦA BẠN` và `+ THÊM MÓN ĂN` cùng một hàng; `(0 Sản phẩm)` **xuống dòng**.
- Nút `TIẾP TỤC` là **thanh dính đáy, full-width, bo góc 0** — không nằm trong card tổng tiền như desktop.

### Mobile — lưới món (#5) ⚠️ mâu thuẫn với spec

- Header dính: logo + 4 icon vòng tròn + **hamburger** (nav ngang gập vào).
- Dải danh mục cuộn ngang chỉ hiện **~3.5 tile**, kèm **dot pagination** (8 dot, dot đầu active đỏ) bên dưới.
- Banner khuyến mãi wrap 2–3 dòng.
- **Card món xếp 1 CỘT** — ảnh full chiều rộng, tên, 2 dòng mô tả xám, giá đỏ lớn, nút `+` phải.
  → **ÁP DỤNG cho quán ta.** Đã chốt theo ref, xem CONFLICT-DESIGN-01 bên dưới.

> **CONFLICT-DESIGN-01 — ĐÃ CHỐT 2026-07-30: dùng 1 CỘT trên mobile (theo ref, lệch spec).**
>
> Spec §8-bis (dòng 189–193) ghi *"lưới 4 cột desktop / **2 cột mobile**"*, còn ảnh ref mobile thật
> của Lotteria là **1 cột**. Chủ dự án chốt **theo ref: 1 cột** — ảnh món to hết chiều rộng, đúng
> hướng G-3 *"giữ khách ở lại lâu để chọn món"*.
>
> **Lệch spec → đã ghi `OVERRIDE-DEBT.md` OD-05.** Phần *"4 cột desktop"* của §8-bis vẫn giữ đúng.
>
> Thi công bằng `repeat(auto-fill, minmax(280px, 1fr))`, **không media query** — bậc tự nhảy:
> ~360px → 1 cột · ~768px → 2 cột · ~1200px → 4 cột.
>
> Đánh đổi: mỗi màn thấy ít món hơn, khách cuộn nhiều hơn. Bù lại card rộng nên **giữ được**
> mô tả thành phần và cho giá + nút `+` nằm cùng một dòng.

## Lệch có chủ ý so với Lotteria (đã chốt)

- Bỏ icon tài khoản (không có login) → thay bằng **"Đơn của tôi"** → `/history`
- Bước 2 checkout đổi tên **"Thông tin nhận hàng"** (không thu tiền online — M2.D-58, spec:197)
- **Bỏ card `Tùy chọn`** (dụng cụ ăn / tương cà / tương ớt) — spec:203
- **Bỏ checkbox `Thu thập thông tin cá nhân`**, thay bằng dòng *"Thông tin của bạn chỉ dùng để giao đơn này."* — spec:204
- Không giá gạch ngang / combo / coupon (quán không có khuyến mãi) — nhưng **"Bán chạy"** suy được từ dữ liệu bán thật
- Không có `MY COUPON` FAB, không chat bot
