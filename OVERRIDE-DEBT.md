# OVERRIDE-DEBT.md

Sổ ghi các lần **đi lệch một quyết định đã LOCKED** trong `docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md`.

Spec §28 và §134 yêu cầu: *"Mọi quyết định M2.D-01..71 đã chốt, không cần hỏi lại. **Không đổi** mà không ghi vào `OVERRIDE-DEBT.md`"*. File này trước 2026-07-30 **chưa tồn tại** — nghĩa là các override trước đó không được ghi ở đâu cả. Nay lập lại và ghi bù.

Mỗi entry phải trả lời: lệch cái gì · ai quyết · vì sao · hệ quả nếu sau này muốn quay lại.

---

## OD-01 — Mở rộng M2.D-67: so khớp origin chính xác thay vì `startsWith`

- **Ngày:** 2026-07-29 · **Người quyết:** chủ dự án (trong 6 quyết định gate ingest)
- **Quyết định gốc:** M2.D-67 chỉ yêu cầu *"`ALLOWED_ORIGIN` thành danh sách 2 origin phân tách dấu phẩy"*.
- **Lệch:** thêm việc đổi cách so khớp — parse `new URL()` rồi so `protocol + '//' + host` **bằng đúng bằng**, bỏ hẳn `origin.startsWith(allowed)`.
- **Vì sao:** làm đúng chữ spec vẫn để hở prefix-spoofing. Với `ALLOWED_ORIGIN=https://quanbalun.site`, origin `https://quanbalun.site.evil.com` vẫn lọt vì không có ranh giới sau prefix. M2 chính là lúc thêm origin thứ hai + endpoint mutation công khai đầu tiên, tức đúng lúc so sánh lỏng bắt đầu có hậu quả.
- **Đây là SIẾT CHẶT, không phải nới lỏng** — không có rủi ro chức năng.
- **Ghi ở:** `constraints.md` C-SEC-01 · thi công ở plan 07-02 + 07-03 · 18 unit test bảo vệ.
- **Quay lại thì sao:** revert về `startsWith` là mở lại lỗ. Không nên. Nếu buộc phải, phải xoá luôn 3 test trong nhóm "chặn prefix-spoofing" — coi đó là dấu hiệu cảnh báo.

## OD-02 — Thêm `Referrer-Policy: no-referrer` cho site block `order.`

- **Ngày:** 2026-07-29 · **Người quyết:** Claude đề xuất, chủ dự án duyệt qua plan 07-04
- **Quyết định gốc:** M2.D-69 chỉ nói block `order.` cần `Permissions-Policy: geolocation=(self)`. Spec **không đề cập** `Referrer-Policy`.
- **Lệch:** thêm `Referrer-Policy "no-referrer"` vào block `order.` (block apex giữ `strict-origin-when-cross-origin`).
- **Vì sao:** `order_token` là bearer credential nằm ngay trong URL `/o/<token>`. Thiếu header này, khách bấm link ngoài từ trang tracking là token rò sang site đó qua `Referer`. Nếu làm đúng chữ spec thì mất hẳn phần bảo vệ này.
- **Ghi ở:** `constraints.md` C-INFRA-03 · thi công ở plan 07-04.
- **Quay lại thì sao:** bỏ header = token rò. Phần còn lại của C-INFRA-03 (mask 4 ký tự đầu trên UI) vẫn nợ, sẽ làm ở phase 9.

## OD-03 — Thêm `/api` vào `apiPrefixes` (sửa bug, không phải đổi spec)

- **Ngày:** 2026-07-29 · **Người quyết:** phát hiện khi test, sửa luôn
- **Quyết định gốc:** không có quyết định nào bị lệch. Ghi vào đây vì nó **sửa hành vi production của Milestone 1**, và người review spec M2 cần biết.
- **Việc:** `apps/api/src/main.ts` — thêm `'/api'` vào `apiPrefixes` của SPA fallback.
- **Vì sao:** Nest đăng ký router trong `app.init()` (bên trong `listen()`), tức **sau** mọi `app.use()` ở `bootstrap()`, nên middleware fallback đứng trước router. Thiếu `'/api'` thì `GET /api/public/*` trả `index.html` thay vì JSON, **kể cả với `Accept: application/json`**. Đã dựng lại được bằng curl. Không sửa thì cả 25 endpoint khách của phase 8–9 chết ở production trong khi dev vẫn chạy đúng.
- **Ghi ở:** `07-01-SUMMARY.md` · `07-CONTEXT.md` D-05 (đã đánh dấu bản đầu SAI).

## OD-04 — Thay hẳn bảng màu §8-bis bằng màu chụp từ món ăn của quán

- **Ngày:** 2026-07-30 · **Người quyết:** chủ quán (cung cấp 4 ảnh món ăn + chỉ định *"màu chủ đạo của quán, hãy làm trang web theo màu này"*)
- **Quyết định gốc:** §8-bis (spec dòng 145–204) chốt bảng màu rút từ ảnh **lotteria.vn**: đỏ coral `#E4453A`, nền trắng/hồng rất nhạt `#FFF9F8`, pastel danh mục lạnh (tím/xanh/mint). M2.D-70/71 thuộc nhóm customer-UI dựa trên bảng này. Spec dòng 163 có ghi *"cần logo quán để chốt màu chính"* — nên việc đổi màu là **đã lường trước**, nhưng phạm vi đổi thì rộng hơn dự kiến.
- **Lệch:**
  1. Đỏ coral `#E4453A` → **đỏ ớt `#cf3323`** (thang 500/600/700 = `#cf3323` / `#b82a1e` / `#8f1d14`)
  2. Nền hồng nhạt `#FFF9F8` → **kem ấm `#fdf7ee`**
  3. Chữ đen/xám thuần → **nâu gỗ trầm** (`#2a1d14` / `#3a2b1f` / `#6e5c4c`)
  4. Viền xám → **nâu nhạt** (`#efe6d8` / `#ddd0bd` / `#b5a48d`)
  5. Pastel danh mục **lạnh → ấm** (bỏ tím/xanh/mint, thay bằng ớt/cà rốt/nghệ/rau/tre/gỗ/mâm hồng)
  6. **Thêm 2 họ màu mới** spec không có: gỗ–hổ phách (`wood-*`) và xanh rau (`herb-*`)
- **Vì sao:** spec dùng Lotteria làm mẫu **tham chiếu bố cục**, không phải mẫu thương hiệu. 4 ảnh món ăn thật của quán không có chi tiết nào màu hồng-trắng: tông là bàn gỗ + đèn lồng hổ phách + ớt đỏ + rau xanh, trên mâm tre và lá chuối. Giữ bảng màu Lotteria là để quán mang nhận diện của một chuỗi fast-food.
- **Bằng chứng đo được (không phải cảm nhận):** bảng màu mới **tốt hơn về tiếp cận**. `brand-500` mới đạt 4.75:1 trên nền (đạt AA cả chữ nhỏ) so với `#E4453A` chỉ 3.87:1 (fail); `text-muted` 5.98:1 so với 5.19:1. Toàn bộ tỉ lệ tính bằng công thức WCAG 2.1, script ở lịch sử phiên.
- **Rủi ro đã ghi nhận:** màu ấm nhất trong ảnh (hổ phách `#e8a33d`) chỉ đạt **2.02:1** → **không dùng được cho chữ hay nút**, chỉ làm nền. Đã ghi cảnh báo ngay trong `tokens.css` và `DESIGN.md` để người sau không nâng nó lên làm màu chữ.
- **Ghi ở:** `apps/shop/src/styles/tokens.css` (nguồn sự thật) · `apps/shop/DESIGN.md` · xem trực quan ở `apps/shop/src/BrandPreview.tsx`
- **Quay lại thì sao:** đổi 3 dòng `--brand-500/600/700` + `--bg-page` trong `tokens.css` là về được, vì không nơi nào hardcode hex. Nhưng quay về `#E4453A` sẽ **làm hỏng AA cho chữ đỏ nhỏ và nút** — phải khôi phục lại cả lớp ngoại lệ cũ.
- **Còn nợ:** §8-bis vẫn ghi bảng màu Lotteria trong file spec. Chưa sửa file spec (spec là văn bản đã chốt vòng 5). Ai đọc §8-bis phải biết `tokens.css` mới là nguồn sự thật — điều này đã có trong C-UI-01.

## OD-05 — Lưới món mobile: 1 cột thay vì 2 cột như §8-bis

- **Ngày:** 2026-07-30 · **Người quyết:** chủ dự án
- **Quyết định gốc:** §8-bis (spec dòng 189–193) ghi *"lưới 4 cột desktop / **2 cột mobile**"*.
- **Lệch:** mobile dùng **1 cột**.
- **Vì sao:** ảnh ref mobile thật của lotteria.vn (chủ dự án cung cấp 2026-07-29) xếp **1 cột** — ảnh món to hết chiều rộng. Đúng hướng G-3 *"giao diện giữ khách ở lại lâu để chọn món"*: ảnh món là thứ bán được hàng, card 2 cột trên máy 360px chỉ còn ~160px thì ảnh nhỏ và mô tả thành phần phải ẩn.
- **Đánh đổi đã biết:** mỗi màn thấy ít món hơn → khách phải cuộn nhiều hơn để xem hết menu. Chấp nhận.
- **Đường đi từng bước của quyết định này** (ghi lại để không ai tưởng là làm bừa): 2026-07-30 chủ dự án chốt 2 cột theo spec → xem bản dựng thật trên `BrandPreview` → đổi sang 1 cột. Bản 2 cột đã commit ở `302d87e`, bản 1 cột ở commit sau.
- **Cách thi công:** `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))` — **không dùng media query**. Bậc tự nhảy theo bề rộng: ~360px → 1 cột · ~768px → 2 cột · ~1200px → 4 cột. Nên phần *"4 cột desktop"* của §8-bis **vẫn giữ đúng**, chỉ khác ở mobile.
- **Ghi ở:** `docs/design-refs/lotteria/README.md` § CONFLICT-DESIGN-01 · `apps/shop/src/BrandPreview.tsx` (`dishGrid`)
- **Quay lại thì sao:** đổi `280px` thành `160px` là về 2 cột mobile. Nhưng phải đồng thời ẩn mô tả thành phần dưới 768px và cho giá + nút `+` xếp 2 dòng — card 160px không chứa nổi cả ba.

## OD-06 — `images[]` của M2.D-43 map từ cột `image_url`, không thêm bảng ảnh

- **Ngày:** 2026-07-30 · **Người quyết:** chủ dự án (D-09)
- **Quyết định gốc:** M2.D-43 mô tả `GET /api/public/menu` trả field `images[]`.
- **Lệch:** schema DB **không đổi** — `menu_items` vẫn chỉ có `image_url varchar(512)`; BE map
  `image_url ? [image_url] : []` (0..1 phần tử).
- **Vì sao:** card món trong `08-UI-SPEC.md` chỉ vẽ 1 ảnh, và nhiều ảnh/món không nằm trong REQ-I..L. Giữ
  **hợp đồng API** dạng mảng để sau thêm bảng `menu_item_images` thì FE không phải sửa gì.
- **Ghi ở:** `packages/schemas/src/public-menu.ts`, `apps/api/src/modules/public/public-menu.mapper.ts`,
  test `public-menu-shape.test.ts` có case `image_url = null` → `[]`.
- **Quay lại thì sao:** thêm bảng ảnh riêng + sửa mapper là đủ; **không** phải sửa FE vì hợp đồng đã là mảng.
  Ngược lại nếu ai đổi API thành `image_url` đơn lẻ thì mới là phá hợp đồng.

## OD-07 — "OFF đến hết hôm nay" thi công bằng tính-lúc-đọc, không cron

- **Ngày:** 2026-07-30 · **Người quyết:** chủ dự án (D-17)
- **Quyết định gốc:** M2.D-28 mô tả hành vi "tự ON lại 00:00 Asia/Ho_Chi_Minh" — cách hiểu tự nhiên là 1 job
  chạy lúc nửa đêm.
- **Lệch:** **không có cron**. Lưu `online_ordering_off_until_ms` = 23:59:59.999 ICT hôm nay; mỗi lần đọc
  trạng thái, `evaluateOrderingStatus()` so với giờ hiện tại và tự coi là đã ON. Cột DB vẫn ghi `false`
  trong khi hành vi thực tế là ON — **đây là điểm người sau dễ hiểu sai**, nên cấm đọc thẳng cột
  `online_ordering_enabled` ở bất kỳ đâu ngoài hàm đó.
- **Vì sao:** sống sót qua restart container và mất điện VPS; repo đang có **2 cron chết** (xem STATE.md) nên
  thêm cron là thêm điểm chết im lặng thứ ba. Dùng cùng cơ chế cho cả "ngoài giờ mở cửa" (M2.D-30).
- **Ghi ở:** `apps/api/src/modules/public/store-status.ts` (+ `store-status.test.ts` có case qua nửa đêm),
  `apps/api/src/modules/settings/settings.service.ts` (`getOrderingStatus`).
- **Quay lại thì sao:** muốn dùng cron thì phải đồng thời bỏ nhánh auto-revert trong hàm thuần, nếu không sẽ
  có 2 cơ chế cùng quyết định 1 trạng thái.

## OD-08 — Route admin mới không có tiền tố `/api`

- **Ngày:** 2026-07-30 · **Người quyết:** chủ dự án (chốt trong phiên planning phase 8)
- **Quyết định gốc:** spec §5.2 ghi `/api/admin/settings` và `/api/admin/phone-blacklist`.
- **Lệch:** thi công `@Controller('admin/settings')` và `@Controller('admin/phone-blacklist')` — **không**
  `/api`.
- **Vì sao:** toàn bộ route admin có sẵn từ Milestone 1 đều không có `/api`
  (`admin/users`, `admin/audit`), và `apps/web/src/lib/api.ts` gọi thẳng `/admin/...`. Cả 2 cách đều
  route đúng vì `apiPrefixes` trong `main.ts` liệt kê cả `/api` lẫn `/admin`, nên đây là **lệch chữ,
  không lệch hành vi**.
- **Ghi ở:** `apps/api/src/modules/settings/settings.controller.ts`,
  `apps/api/src/modules/settings/phone-blacklist.controller.ts`, `apps/web/src/pages/AdminSettingsPage.tsx`.
- **Quay lại thì sao:** đổi 2 decorator + 4 chỗ gọi ở `apps/web`. Nhưng khi đó `admin/users`/`admin/audit`
  thành không nhất quán — nên nếu muốn bám chữ spec thì phải đổi **cả** route cũ, tức là phá API đang
  chạy production.

## OD-09 — Placeholder ảnh món không còn in tên món chữ (lệch D-10)

- **Ngày:** 2026-07-30 · **Người quyết:** phát hiện + sửa khi chủ quán báo card món "trông vỡ", ghi bù ở
  plan 08-13 (thi công thật ở commit `d31649c`, giữa wave 5 và wave 6, ngoài phạm vi mọi plan 08-xx đã viết)
- **Quyết định gốc:** D-10 (`08-CONTEXT.md`) chốt placeholder ảnh gồm "nền gỗ ấm + icon bát + **tên món**".
- **Lệch:** `ImagePlaceholder.tsx` không còn render tên món thành chữ nhìn thấy được nữa — chỉ còn nền
  `--wood-100` + icon bát SVG. Tên món vẫn tới được trình đọc màn hình qua `aria-label`.
- **Vì sao:** `CardItem.tsx` đã render tên món ở `<h3>` ngay dưới vùng ảnh — khi món không có ảnh thật, tên
  bị in **2 lần liên tiếp** (1 lần trong ô placeholder, 1 lần ở `<h3>`), khiến card trông như lỗi dữ liệu
  thay vì placeholder có chủ ý. Bỏ tên khỏi ô ảnh giữ đúng tinh thần D-10 (placeholder "có chủ ý, không
  giống ảnh lỗi") mà D-10 hướng tới, chỉ khác cách đạt được.
- **Ghi ở:** `apps/shop/src/components/ImagePlaceholder.tsx`, `apps/shop/src/components/CardItem.tsx`.
- **Quay lại thì sao:** thêm lại dòng chữ tên món trong `ImagePlaceholder.tsx` là về đúng chữ D-10, nhưng
  phải đồng thời ẩn tên ở `<h3>` của `CardItem.tsx` khi không có ảnh thật, nếu không sẽ tái lặp lỗi in tên 2
  lần đã bị chủ quán báo.

## OD-10 — Tỉ lệ khung ảnh card món đổi từ 4/3 (D-11) sang 3/2

- **Ngày:** 2026-07-30 · **Người quyết:** phát hiện + sửa khi chủ quán báo desktop chỉ thấy 1 hàng món (cùng
  đợt sửa với OD-09, commit `d31649c`)
- **Quyết định gốc:** D-11 (`08-CONTEXT.md`) chốt "Ảnh trong card dùng `object-fit: cover` trên khung
  `aspect-ratio: 4/3`". (Lưu ý: `08-UI-SPEC.md` dòng 226 chỉ ghi đây là **khuyến nghị** "4:3", không phải
  giá trị khoá cứng ở tài liệu đó — nhưng D-11 trong `08-CONTEXT.md` là quyết định đã chốt với chủ dự án,
  nên vẫn tính là lệch cần ghi.)
- **Lệch:** đổi sang `aspect-ratio: 3/2` qua token mới `--ratio-card-media`, dùng chung cho ảnh thật và
  placeholder.
- **Vì sao:** khung 4/3 làm card cao ~465px, desktop chỉ thấy đúng 1 hàng món trước khi cuộn — vi phạm tinh
  thần G-3 ("giao diện giữ khách ở lại lâu để chọn món") theo hướng ngược lại: quá ít món nhìn thấy cùng lúc
  làm khách phải cuộn nhiều hơn để có cảm giác "còn gì để chọn". 3/2 giữ ảnh đủ lớn để làm chủ thể bán hàng
  nhưng cho thấy nhiều hàng hơn.
- **Ghi ở:** `apps/shop/src/styles/tokens.css` (token `--ratio-card-media`), `apps/shop/src/components/CardItem.tsx`,
  `apps/shop/src/components/ImagePlaceholder.tsx`.
- **Quay lại thì sao:** đổi giá trị token `--ratio-card-media` từ `3/2` về `4/3` là đủ (1 chỗ, dùng chung ảnh
  thật + placeholder) — nhưng sẽ tái lặp vấn đề "desktop chỉ thấy 1 hàng món" mà chủ quán đã báo.

---

## Chưa được ghi ở đây (nợ tồn từ trước)

Hai chuỗi override **nội bộ spec** mà spec §28 yêu cầu ghi vào file này, hiện chỉ nằm ở `.planning/intel/decisions.md`:

- **M2.D-59 ghi đè M2.D-41** — blacklist SĐT thêm/xoá tay, bỏ TTL 24h, bỏ `cron-blacklist-cleanup.ts`
- **M2.D-60 ghi đè M2.D-36 (chỉ ngưỡng auto-OFF)** — `escalate_autooff_after_s = 1800` thay `300`. Rung SMS 90s của M2.D-36 vẫn còn hiệu lực. **Pseudo-code spec dòng 469 vẫn ghi `300s` — stale, không implement.**

Hai cái này do chính chủ quán chốt trong vòng review spec, không phải override do thi công. Ghi lại ở đây cho đủ theo §28.
