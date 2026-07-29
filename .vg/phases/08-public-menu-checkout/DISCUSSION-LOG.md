# Discussion Log — Phase 08

## Session 2026-07-29 — Initial Scope

**Cấu hình:** challenger `adversarial_max_rounds: 3` · expander `dimension_expand_max: 6`
**Đã dùng:** challenger **3/3** (hết loop guard sau R3 → R4/R5 tự bỏ theo skip path #2 của
HARD-GATE) · expander **5/6**
**Tổng tương tác:** 5 vòng + 6 deep probe = **11 lượt** (yêu cầu tối thiểu 10)

Mọi phát hiện của challenger/expander đều được **AI tự kiểm chứng lại bằng code** trước khi
trình bày cho chủ quán — không nhận nguyên văn kết quả subagent.

---

### Round 1: Domain & Business

**Q:** AI trình bày 7 user story (US-1..US-7), 3 vai trò (khách / `admin` / `order`), 8 quy tắc
nghiệp vụ BR-1..BR-8 rút từ SPECS, rồi hỏi 4 chỗ SPECS chưa nói rõ: định nghĩa "Bán chạy",
tìm kiếm có bỏ dấu tiếng Việt hay không, giới hạn số lượng mỗi món, và giỏ hàng có giữ lại
khi đóng trang.

**A:** Bán chạy = top 10 theo số lượng bán 30 ngày. Tìm kiếm bỏ dấu + không phân biệt hoa
thường, tìm cả theo mã hàng. Tối đa 20 phần/món, từ 10 phần hiện dòng nhắc. Giỏ hàng lưu
localStorage kèm hạn 24h.

**Challenger (1/3) → verdict FLAWED**, 2 CRITICAL + 4 MAJOR. AI kiểm chứng bằng code, cả 4
điểm đáng xử lý đều đúng:
- F1: `order_items` có cột `is_note` (comment tại `order-item.entity.ts:42` cảnh báo sẵn phải
  loại khỏi top bán chạy) và món `CANCELLED` vẫn nằm trong đơn đã thanh toán. Báo cáo nội bộ
  (`orders.service.ts:1134-1150`) xếp theo **doanh thu** nên ghi chú giá 0đ tự chìm; xếp theo
  **số lượng** thì "lấy bát cho khách" leo top 1.
- F2: giỏ lưu giá đụng luật chốt giá tại submit — khách thấy một số, đơn ghi số khác.
- F3: `data-source.ts:20` chỉ `charset: 'utf8mb4'`; trong `utf8mb4_general_ci` thì **`đ ≠ d`**
  nên "dau hu" không ra "Đậu Hũ".
- F4: `orders` chỉ có `idx_orders_table(table_id, closed_at)` — `closed_at` ở cột thứ hai nên
  lọc theo mình nó phải quét toàn bảng; `order_items` không có index trên `menu_item_id`.

**A (xử lý challenger):** Lọc đúng + cache 30 phút + 2 index mới, trả về chỉ ID đã xếp hạng.
Giỏ chỉ lưu ID/SL/ghi chú. Tìm kiếm làm ở phía trình duyệt. Thêm trần cấp đơn 30 dòng + 100
phần, chạm trần thì hiện nút gọi quán. Đối chiếu giỏ khi mở lại. Backend validate món còn bán
khi submit.

**Expander (1/6):** 5 CRITICAL_MISSING. Nặng nhất là CM1 — phase 08 ship trước phase 09 nên
chưa có thông báo/leo thang; enum status không có trạng thái hết hạn, cộng luật 1 đơn mở/SĐT
thì **một đơn chết hôm nay khoá luôn số điện thoại đó mãi mãi**.

**A (xử lý expander):** `EXPIRED` sau 45 phút + nhả khoá SĐT. `PATCH` sửa món/ghi chú/tên/địa
chỉ, SĐT khoá cứng. Chuẩn hoá SĐT dùng lại regex `/^0\d{9}$/` của POS. Trùng SĐT thì mở đơn
đang chờ. `last_order_before_close_min` = 30. Ba ngưỡng ship 15km/100k/1 triệu, chặn thật.
Rượu bia bán bình thường. Máy dùng chung: giữ giới hạn gốc + 3 giảm thiểu. Widget công tắc
hiện đúng trạng thái thực.

**Locked:** P08.D-01 … P08.D-16

---

### Round 2: Technical Approach

**Q:** AI quét codebase, trình bày bảng 10 module (hiện trạng → đề xuất), 3 bảng DB mới, và
nêu 2 phát hiện: `.claude/vg.config.md:717` khai `surfaces.web.paths = ["apps/web","apps/api"]`
**không có `apps/shop`**; project **chưa có** `packages/utils` và `PROJECT.md` không có mục
Shared Utility Contract. Hỏi 4 điểm: xử lý surface gap, chỗ đặt 6 helper dùng chung, con số
rate limit cho `/api/public`, và cách phát hiện đơn hết hạn + hạn lưu đơn cũ.

**A:** Khai surface mới `shop`. Tạo `packages/utils`. Rate limit 3 mức riêng theo endpoint.
Hết hạn tính khi đọc + cron 5 phút, đơn cũ lưu 90 ngày.

**Challenger (2/3) → verdict FLAWED**, 4 CRITICAL + 3 MAJOR. AI kiểm chứng — tất cả đúng:
- F1: `@nestjs/throttler@^6.2.0` duyệt **mọi** định nghĩa cho **mọi** route → named throttler
  `{limit:5,ttl:1h}` sẽ giới hạn luôn `POST /orders` của POS nội bộ. Và guard chạy **trước**
  `ValidationPipe` nên key theo SĐT đọc body thô, 3 dạng viết SĐT là 3 key khác nhau.
- F2: `main.ts:46` `apiPrefixes` **không có `/api`**, và nhánh `wantsHtml` chạy trước → mọi
  `GET /api/public/*` trả `index.html` **chỉ trên production**, local dev pass hết.
- F3: `@nestjs/schedule` **0 match**; `docker-compose.prod.yml`/`deploy.sh`/`DEPLOY.md` đều
  **0 match** "cron"; runtime stage chỉ copy `dist` + cài `--prod` nên 2 cron hiện có (dùng
  `src/` + `@swc-node/register`) **không chạy được trên production**.
- F4: `SELECT` rồi `INSERT` không chống được 2 request song song; MySQL 8 không có partial
  index nên chặn thật ở tầng DB cần generated column hoặc cột phụ.
- F5: Dockerfile liệt kê manifest **bằng tay** (dòng 14-16, 55-57) và copy
  `packages/schemas/dist` riêng (dòng 63) → thêm `packages/utils` mà không sửa Dockerfile là
  `ERR_PNPM_OUTDATED_LOCKFILE`.
- F6: `csrf-origin.middleware.ts:35` dùng `origin.startsWith(allowed)` — AI test bằng node:
  `'https://quanbalun.site.evil.com'.startsWith('https://quanbalun.site')` → **`true`**. Và
  `pathRequiresCheck` chỉ phủ `/admin/` + `/auth/` nên `PUT /api/admin/settings` không được
  kiểm origin.
- F7: xoá cứng 90 ngày phá chính dữ liệu phase 10 cần đọc.

**A (xử lý challenger):** Giữ 1 throttler global + override từng route; guard riêng cho
`POST /orders` normalize SĐT trước khi đếm; thêm `expires_at` + cột chặn trùng UNIQUE;
`@nestjs/schedule` in-process và **sửa luôn 2 cron đang chết**; đổi xoá cứng thành ẩn danh
hoá. Ba bản sửa hạ tầng (F2, F5, F6) **đẩy về phase 07**.

**Expander (2/6):** 5 CRITICAL_MISSING. AI kiểm chứng:
- CM3: grep `Ho_Chi_Minh|timeZone|process.env.TZ` trong `apps/` + `packages/` = **0 kết quả**;
  `docker-compose.prod.yml:21` chỉ set `TZ: UTC` cho mysql; `node:20-alpine` không có `tzdata`.
- CM2: script seed (`package.json:17-18`) cùng gốc lỗi với F3 → `store_settings` sẽ **rỗng**
  sau deploy.
- CM1: TypeORM 0.3.29 so `asExpression` với `GENERATION_EXPRESSION` đã chuẩn hoá lại của MySQL
  8 → sync cố tạo lại cột **mỗi lần restart**, có thể **crash boot kéo POS xuống theo**.
- CM5: `data-source.ts:32` `connectionLimit: 50`, comment ghi rõ đã phải nâng một lần vì POS
  poll 2 giây làm cạn pool.

**A (xử lý expander):** Giờ VN dùng `Intl`, không đổi TZ tiến trình. `store_settings` giữ EAV
+ `OnModuleInit` upsert, công tắc mặc định OFF. Bỏ generated column, dùng cột thường. Khoá bất
biến 1 tiến trình + cron heartbeat. Bốn lớp bảo vệ pool DB. 429 luôn có nút gọi quán.

**Locked:** P08.D-17 … P08.D-29, P08.D-surfaces, P08.D-utilities

---

### Round 3: API Design

**Q:** AI trình bày 10 endpoint (7 public + 3 nhóm admin) map sang quyết định vòng 1–2, cộng
7 mã lỗi mới. Hỏi 4 điểm: shape khi đơn `EXPIRED`, cách chống bấm 2 lần, cách trả
`bestseller_ids`, và `PUT /settings` ghi từng phần hay cả khối.

**A:** `EXPIRED` trả status + câu giải thích + SĐT + món. Chống bấm 2 lần bằng chính UNIQUE
`open_phone_lock`. `bestseller_ids[]` nằm trong cùng response menu. Ghi từng phần.

**Challenger (3/3 — hết loop guard) → verdict FLAWED**, 2 CRITICAL + 5 MAJOR:
- F1: **bắt được lỗi trong quyết định AI tự đề xuất ở vòng 1.** Lỗi trùng khoá UNIQUE chỉ mang
  1 bit "có đơn WAITING với SĐT này". Trả về đơn đó biến `POST /orders` thành máy tra cứu →
  mở lại đúng lỗ hổng **M2.D-10 đã cấm** ("biết SĐT = xem được đơn người khác"). AI kiểm chứng
  nguyên văn M2.D-10 tại spec dòng 48 — đúng.
- F3: `ErrorEnvelope` (`errors.ts:27-42`) không có field chứa dữ liệu máy đọc được;
  `global-exception.filter.ts:87` ghi đè message **vô điều kiện**; `mapStatusToCode(429)` trả
  `AUTH_RATE_LIMITED` → khách cuộn menu hơi nhanh nhận câu *"Bạn thử đăng nhập sai nhiều quá.
  Đợi 15 phút rồi thử lại nhé."*
- F4: Caddyfile ghi nguyên URI vào `docker logs` → `customer_token` trong query string là rò
  rỉ token vĩnh viễn.
- F5: gộp `bestseller_ids` vào cache menu làm cờ hết hàng đóng băng theo TTL 30 phút, mà
  `toggle-stock` của bếp không phát tín hiệu xoá cache.
- F6: `PATCH` chưa định nghĩa merge hay replace; và "validate lại toàn bộ" khiến khách muốn
  **bớt** món lúc 22h05 bị chặn — không bớt được mà cũng không huỷ được.

**A (xử lý challenger):** Trùng SĐT trả 409 **không kèm token**, chỉ mở lại đơn khi cùng
`customer_token`; chống bấm 2 lần đổi sang `client_request_id`. Thêm `details` vào
`ErrorEnvelope`, sửa dòng 87 thành có điều kiện, subclass `ThrottlerGuard`. Cache chỉ
`/store` + `/menu`, token sang header `X-Customer-Token`, 2 mức cache tách rời. `PATCH` full
replace + `If-Match`, tách luật validate.

**Expander (3/6):** 5 CRITICAL_MISSING. AI kiểm chứng:
- `main.ts:81` `forbidNonWhitelisted: true` **toàn cục** → server **từ chối** field lạ bằng
  400, không âm thầm bỏ qua.
- `menu.controller.ts:136` trả `getManyAndCount()` **raw entity** — không có tầng DTO nào.
- `menu-item.entity.ts:34` chỉ có **một** `image_url`, không có `images[]` như spec ghi.
- `menu-group.entity.ts` **không có `parent_id`** → nhóm hàng **phẳng**, không phải 3 cấp như
  REQ-A và tiêu chí phase 02 yêu cầu.

**A (xử lý expander):** CSRF phủ `/api/admin/` và **loại trừ tường minh** `/api/public/` (kẻo
`curl` không có Origin bị chặn, phá AC-K1). Nhóm hàng dùng phẳng, sửa SPECS. Ảnh món theo DB.
`GET /menu` có DTO tường minh. DTO submit tối thiểu. `map_link` server tự sinh. 409 kèm dữ
liệu qua `error.details`. Công bố bảng 14 mã → status. Thứ tự check cố định + trả hết dòng lỗi.

**Locked:** P08.D-30 … P08.D-45

---

### Round 4: UI/UX

**Q:** AI phát hiện `apps/shop/DESIGN.md` + `src/styles/tokens.css` **đã tồn tại** (tạo ngoài
phiên thảo luận) nên đọc 2 file đó làm nguồn sự thật thay vì tự đề xuất token. Design system
đó **sửa 3 lỗi tương phản WCAG AA** trong §8-bis mà AI viết: `#888` = 3.40:1 → `#726865`
5.19:1; chữ đỏ nhỏ `#E4453A` 3.87:1 → `brand-600`; chữ trắng trên nút `#E4453A` 4.03:1 →
`brand-600` 5.11:1. AI kiểm độ khớp `tokens.css` ↔ `DESIGN.md`: **30/30 màu khớp**. Trình bày
bảng 8 trang + component, hỏi 4 điểm: lưới món mobile mấy cột, trang `/o/:token` hiện gì khi
chưa có % tiến độ, `OpenHoursEditor` có nghỉ trưa không, và bao nhiêu weight font.

**A:** Lưới 2 cột ảnh vuông. Không đếm ngược 45 phút. Cho 2 khung giờ mỗi ngày. Baloo 2 weight
800 + Be Vietnam Pro 400/600.

**Challenger: BỎ** — đã dùng hết 3/3 loop guard.

**Expander (4/6):** 5 CRITICAL_MISSING, trong đó 3 cái là lỗi trong danh sách component của
chính AI. AI kiểm chứng: grep `header` trong DESIGN.md = **0 kết quả**; `apps/shop` có **0 file
`.tsx`**; `--z-floating-cart` và `--z-sticky-cta` **cùng bằng 200**; chú thích `--r-sheet` vẫn
ghi "bottom sheet chi tiết món" trong khi chi tiết món đã chốt là trang riêng.

**A (xử lý expander):** `AppShell` + `AppHeader` 2 biến thể, `OrderHistoryList` mỗi dòng bấm
được để mở `/o/:token`. Bộ component trạng thái + câu chữ ở `copy/vi.ts`. Trạng thái lúc gửi
đơn: disable + spinner + chặn bấm, xoá giỏ **sau** khi có token, điều hướng `replace`. Sửa đơn
bằng bottom sheet tại chỗ. Sửa 2 chỗ trong `tokens.css`.

**Về Impeccable:** chủ quán hỏi có đang dùng không. AI trả lời **chưa** — `impeccable detect`
đã cắm sẵn qua `vg.config.md:301` + `.claude/scripts/validators/verify-design-antipatterns.py`,
nhưng `apps/shop` có 0 file `.tsx` và validator thuộc `/vg:review` (Phase 1c-bis + Phase 2.5
bước 5-bis), không phải `/vg:scope`. AI kiểm được thứ khả thi ngay: `tokens.css` ↔ `DESIGN.md`
khớp 30/30. Nhân đó phát hiện `apps/web/src` có **57 màu hex hardcode**, `styles.css` có **0
CSS variable** (`#6b7280` 121 lần) → không đổi được màu thương hiệu ở một chỗ; là nợ của
`apps/web`, ngoài scope phase 08.

**Locked:** P08.D-46 … P08.D-55

---

### Round 5: Test Scenarios

**Q:** AI trình bày 24 kịch bản TS-01..TS-24 với nhãn `verification_strategy`, hỏi 3 điểm:
cách tua thời gian cho TS-16/TS-17, cách đo TS-09, và mức độ chặn của impeccable + ngân sách
bundle.

**A:** Tách logic thời gian ra hàm nhận `now`. TS-09 đo bằng API đọc số liệu trước/sau.
impeccable chặn ở mức `error`, bundle chỉ cảnh báo.

**Challenger: BỎ** — hết loop guard.

**Expander (5/6):** 5 CRITICAL_MISSING. AI kiểm chứng và phát hiện thêm về Milestone 1:
- `find -name "*.spec.ts"` → **0 file test trong toàn repo**, trong khi
  `apps/api/package.json:11` có `"test": "vitest run"` (script trỏ vào chỗ trống) và phase 01
  có `TEST-STRATEGY.md` hứa MySQL test container.
- `main.ts:26` `app.set('trust proxy', 1)` → nếu số hop sai thì key throttle thành IP của
  Caddy, 60 req/phút biến thành giới hạn cho **toàn bộ khách cùng lúc**. **Test một client duy
  nhất pass y hệt trong cả trường hợp đúng và sai.**
- **17 file** trong `apps/web` dùng `Toast`/`ConfirmDialog` → nâng lên `packages/ui` sẽ sửa 17
  file của app đang bán hàng, mà SPECS phase 08 ghi Out of Scope "không sửa `apps/web`".

**A (xử lý expander):** `apps/shop` tự viết bản riêng, **không** nâng `packages/ui` (sửa
P08.D-51) — nên chỉ còn `packages/utils` là package mới. Ba test tập trung vào đúng 4 điểm
dùng chung + checklist tay. Bốn cách kiểm rate limit sau proxy. Ma trận chuyển trạng thái của
`open_phone_lock` + invariant thường trực. Deploy lần đầu thử trên bản sao prod. Đối chiếu giỏ
cũ khi giá đổi. Assertion allowlist dương cho response public.

**Locked:** P08.D-56 … P08.D-65 (tổng 40 kịch bản TS-01..TS-40)

---

### Loop: Deep Probe

AI tự soi 65 quyết định để tìm mâu thuẫn nội tại, giả định ngầm, và lời hứa hụt. 6 vùng xám,
**4 trong đó là mâu thuẫn giữa các quyết định của chính AI**.

**Probe #1 — Hết hạn tính khi đọc không thể nhả khoá SĐT ở tầng DB.**
P08.D-07 hứa "nhả khoá **ngay**" nhưng P08.D-23 (tính khi đọc) + P08.D-26 (cron xoá lock) →
phút 45–50 trang khách hiện "hết hạn" mà UNIQUE index vẫn giữ khoá, khách đặt lại vẫn 409.
**A:** Kiểm 1-đơn-mở bằng query có `expires_at`, không dựa vào cột lock; cột UNIQUE chỉ còn
việc chặn 2 request song song. → **P08.D-66**

**Probe #2 — ETag của menu không đổi khi bảng "Bán chạy" đổi.**
ETag tính từ `MAX(updated_at)` của menu, mà `bestseller_ids` làm mới mỗi 30 phút không sửa
dòng menu nào → khách nhận `304` mãi.
**A:** ETag gộp thêm `bestseller_generated_at`. → **P08.D-67**

**Probe #3 — Đơn gửi sát giờ chốt đơn chắc chắn chết.**
Quán đóng 22:00, ngưỡng 30 phút → đơn 21:29 hết hạn 22:14, sau khi quán đã đóng.
**A:** Hạn = `min(gửi + 45 phút, giờ đóng cửa)`. → **P08.D-68**

**Probe #4 — Hai DataSource cùng `synchronize: true` tranh nhau lúc boot.**
**A:** DataSource public `synchronize: false`, `entities` trỏ cùng mảng. → **P08.D-69**

**Probe #5 — Nút "Xoá thông tin trên máy này" không xoá được thông tin thật.**
Chỉ xoá `localStorage`; tên/SĐT/địa chỉ vẫn nằm trong DB 90 ngày, trong khi §8-bis hứa
"Thông tin của bạn chỉ dùng để giao đơn này".
**A:** Gọi API ẩn danh hoá ngay các đơn đã ở trạng thái cuối của chính `customer_token` đó;
đơn đang WAITING thì giữ và nói rõ lý do. → **P08.D-70**

**Probe #6 — Khách có đơn đang mở mà thêm món tiếp thì kẹt.**
Gửi đơn xong quay lại `/`, thêm món, checkout → 409 ở bước cuối.
**A:** Banner dính từ MenuPage + nút checkout đổi thành "Xem đơn đang chờ". → **P08.D-71**

**Chỉ thị giữa phiên:** chủ quán yêu cầu **tuyệt đối không động vào app đang chạy production**.
AI xác minh: chưa deploy gì, chưa sửa file nào trong `apps/` do AI. Phát hiện 3 file `apps/web`
đang sửa dở trong working tree (bản sửa Impeccable rule `layout-transition`, không phải AI làm)
và nêu rõ mâu thuẫn: kế hoạch phase 07/08 **bắt buộc** phải sửa code dùng chung với POS
(`main.ts`, CSRF middleware, Dockerfile, Caddyfile, exception filter, ThrottlerGuard, 2 index
trên bảng doanh thu thật, và `synchronize: true` tự ALTER DB lúc boot). Chủ quán làm rõ: **không
DEPLOY**, sửa code local thoải mái. 3 file `apps/web` tách ra commit riêng `e5f426b`.
→ **P08.D-72**

**Kết thúc:** AI đã phân tích cả 72 quyết định để tìm mâu thuẫn, edge case và giả định ngầm.
6 vùng xám đã giải quyết. Không tìm thêm được vùng xám nào có giá trị nên chuyển sang sinh
artifact.

**Locked:** P08.D-66 … P08.D-72

---

### Ghi chú vận hành phát sinh trong phiên

- **Hook `PostToolUse` của TodoWrite không tự ghi evidence** trong môi trường này: nó đọc
  `CLAUDE_HOOK_SESSION_ID` từ biến môi trường, còn Claude Code truyền session id qua stdin
  JSON. Phải gọi hook thủ công với payload thật sau khi TodoWrite chạy.
- **Hai patch vào VG core** (đã báo upstream, ghi `OVERRIDE-DEBT.md`):
  `contracts.py normalize_telemetry` làm mất field `severity` (issue #217);
  `phase-profile.sh detect_phase_profile` bỏ qua khai báo `profile:` trong frontmatter nên xếp
  sai phase 08 thành `infra` (issue #218) — nếu không sửa thì `/vg:scope 08` sẽ **rút gọn, bỏ
  cả 5 vòng thảo luận**.
- **Validator namespace** chặn `CONTEXT.md` vì AI viết tắt `D-10` ở chỗ tham chiếu chéo; đã sửa
  hết thành `P08.D-10`.
