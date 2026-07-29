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

---

## Chưa được ghi ở đây (nợ tồn từ trước)

Hai chuỗi override **nội bộ spec** mà spec §28 yêu cầu ghi vào file này, hiện chỉ nằm ở `.planning/intel/decisions.md`:

- **M2.D-59 ghi đè M2.D-41** — blacklist SĐT thêm/xoá tay, bỏ TTL 24h, bỏ `cron-blacklist-cleanup.ts`
- **M2.D-60 ghi đè M2.D-36 (chỉ ngưỡng auto-OFF)** — `escalate_autooff_after_s = 1800` thay `300`. Rung SMS 90s của M2.D-36 vẫn còn hiệu lực. **Pseudo-code spec dòng 469 vẫn ghi `300s` — stale, không implement.**

Hai cái này do chính chủ quán chốt trong vòng review spec, không phải override do thi công. Ghi lại ở đây cho đủ theo §28.
