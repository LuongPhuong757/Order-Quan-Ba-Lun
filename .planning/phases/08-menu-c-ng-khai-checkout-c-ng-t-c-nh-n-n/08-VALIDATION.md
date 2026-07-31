---
phase: 8
slug: menu-cong-khai-checkout-cong-tac-nhan-don
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-30
updated: 2026-07-31
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Nguồn: `08-RESEARCH.md` §Validation Architecture. Cột `Task ID`/`Plan` được điền lúc chia 13 plan; cột
> `File Exists`/`Status` cập nhật ở plan 08-13 theo kết quả chạy thật (`pnpm --filter @order/api test` +
> `pnpm --filter @order/shop test`, 2026-07-31).
> **Bối cảnh C-TEST-01:** trước phase 8 repo chỉ có ĐÚNG 1 file test (`apps/api/src/common/origin-allowlist.test.ts`).
> Toàn bộ file dưới đây là Wave 0 — harness là việc phải làm, không phải giả định. Nay đã có 10 file test
> `apps/api` (106 test) + 2 file test `apps/shop` (22 test), tất cả xanh.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (zero-config) — `apps/api` đã dùng từ phase 7; `apps/shop` thêm ở plan 08-06 (cùng version `^2.1.0`) |
| **Config file** | none — theo đúng convention `origin-allowlist.test.ts` |
| **Quick run command** | `pnpm --filter @order/api test -- <file>` · `pnpm --filter @order/shop test -- <file>` |
| **Full suite command** | `pnpm --filter @order/api test` + `pnpm --filter @order/shop test` |
| **Estimated runtime** | ~5s cho unit (hàm thuần); ~15s nếu tính file integration chạm MySQL |

**Quyết định harness (chốt 2026-07-30):** đi **hướng nhẹ** — test service với fake-repository cho phần
logic, **không** thêm `@nestjs/testing` + `supertest` + `@types/supertest`. Phần "BE trả 409 thật qua
HTTP" verify bằng `curl` tay trên dev server, ghi thành mục Manual-Only bên dưới. Lý do: 3
devDependency mới cho giá trị tăng thêm (chứng minh guard/pipe) không cao so với effort trong một phase
đã chạm 3 app.

**Bổ sung của planner:** `vitest` được thêm cho `apps/shop` ở plan 08-06 Task 2. Điều này **không** trái
quyết định trên — quyết định đó nói về harness HTTP của `apps/api`. Logic giỏ hàng (hết hạn 24h, đồng bộ
giá/hết hàng theo D-07) và parse link Maps là logic âm thầm hỏng, và `vitest` đã có sẵn trong repo.

---

## Sampling Rate

- **After every task commit:** `pnpm --filter @order/api test -- <file vừa sửa>` (hoặc `@order/shop`)
- **After every plan wave:** `pnpm --filter @order/api test` + `pnpm --filter @order/shop test` + `pnpm -r typecheck` + `pnpm --filter @order/shop build` rồi `sh scripts/check-shop-bundle.sh`
- **Before `/gsd:verify-work`:** full suite xanh + 5 mục Manual-Only dưới đây đã chạy
- **Max feedback latency:** 15 giây

⚠ **Bundle guard đổi ở plan 08-04 Task 3:** `scripts/check-shop-bundle.sh` từ phase 7 **chỉ có gate grep
chuỗi cấm, chưa có gate kích thước nào**. Plan 08-04 giữ nguyên gate grep và **thêm** gate `MAX_JS_KB` đặt
bằng số đo thật lúc đóng plan + ~30%, kèm lý do ghi trong file. Không tắt gate nào.
⚠ Chuỗi `/admin/` nằm trong danh sách FORBIDDEN → **không viết chuỗi này vào file nào của `apps/shop`**,
kể cả comment, nếu không guard báo LEAK oan.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| Task 2 | 08-01 | 1 | REQ-K | T-08-06 | `evaluateOrderingStatus()` đúng mọi tổ hợp manual/`off_until`/giờ mở cửa, kể cả auto-revert qua 00:00 ICT | unit (pure fn) | `pnpm --filter @order/api test -- store-status.test.ts` | ✅ | ✅ green |
| Task 3 | 08-01 | 1 | REQ-L | T-08-05 | `checkOrderGuard()` trả đúng error code theo mọi tổ hợp input, đúng thứ tự ưu tiên spec §7 | unit (pure fn) | `pnpm --filter @order/api test -- order-guard.test.ts` | ✅ | ✅ green |
| Task 3 | 08-01 | 1 | REQ-L | T-08-03 | `hashIp()` không bao giờ trả IP nguyên văn; đổi salt → hash khác (HMAC-SHA256, không SHA256 trần) | unit (pure fn) | `pnpm --filter @order/api test -- ip-hash.test.ts` | ✅ | ✅ green |
| Task 2 | 08-01 | 1 | REQ-J | — | Haversine × `distance_factor` (M2.D-50) ra đúng km cho các cặp toạ độ đã biết | unit (pure fn) | `pnpm --filter @order/api test -- haversine.test.ts` | ✅ | ✅ green |
| Task 1 | 08-05 | 2 | REQ-K | T-08-22 | `endOfTodayIctMs()` trả mốc 23:59:59.999 theo **ngày ICT**, không theo ngày UTC | unit (pure fn) | `pnpm --filter @order/api test -- store-status.test.ts` | ✅ | ✅ green |
| Task 3 | 08-05 | 2 | REQ-L | T-08-25 | `normalizePhone()` map `0912 345 678` / `+84912345678` / `(091) 234 5678` về cùng 1 khoá | unit (pure fn) | `pnpm --filter @order/api test -- phone.test.ts` | ✅ | ✅ green |
| Task 2 | 08-06 | 2 | REQ-I, REQ-J | T-08-26 | Giỏ hết hạn 24h; giá đổi → cập nhật + cờ báo; món hết → giữ dòng, không tính tổng, chặn checkout (D-07) | unit (pure fn) | `pnpm --filter @order/shop test -- cart-store.test.ts` | ✅ | ✅ green |
| Task 1 | 08-07 | 3 | REQ-L | **T-08-32 (HIGH)** | `pathRequiresCheck('/api/public/orders')` = `true`; `/auth/login` `/auth/recover` vẫn `false` | unit (pure fn) | `pnpm --filter @order/api test -- csrf-paths.test.ts` | ✅ | ✅ green |
| Task 3 | 08-07 | 3 | REQ-I | T-08-33 | `GET /api/public/menu` chỉ trả 7 field (`id, code, name, price, unit, images[], is_out_of_stock`); input "bẩn" thêm field giả → `.strict().parse()` throw | unit (`Object.keys()` + zod strict) | `pnpm --filter @order/api test -- public-menu-shape.test.ts` | ✅ | ✅ green |
| Task 1 | 08-10 | 4 | REQ-K, REQ-L | **T-08-49 (HIGH)** | Submit khi `ordering_enabled=false` → `ONLINE_ORDERING_DISABLED`; client nhồi `unit_price: 0` → `subtotal` vẫn theo giá DB | integration (service + fake-repo) | `pnpm --filter @order/api test -- public-orders.test.ts` | ✅ | ✅ green |
| Task 3 | 08-10 | 4 | REQ-L | **T-08-50 (HIGH)** | Gap lock `FOR UPDATE` ngăn 2 request đồng thời cùng SĐT tạo 2 đơn `WAITING`; không chặn oan SĐT khác | integration (MySQL thật, `DataSource` trực tiếp — không bootstrap Nest) | `pnpm --filter @order/api test -- open-order-lock.integration.test.ts` | ✅ | ✅ green |
| Task 1 | 08-12 | 6 | REQ-J | **T-08-65 (SSRF)** | `parseMapsLink` lấy được toạ độ từ link chứa `@`/`q=`/`!3d!4d`; link `maps.app.goo.gl` → `SHORT_LINK`, **không gọi mạng** | unit (pure fn) | `pnpm --filter @order/shop test -- maps-link.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `apps/api/src/modules/public/store-status.test.ts` — criterion (b), theo mẫu `origin-allowlist.test.ts` (plan 08-01 Task 2, mở rộng ở 08-05 Task 1) — 16 test xanh
- [x] `apps/api/src/modules/public/order-guard.test.ts` — phần logic của criterion (a) + (c) (plan 08-01 Task 3) — 11 test xanh
- [x] `apps/api/src/modules/public/ip-hash.test.ts` (plan 08-01 Task 3) — 5 test xanh
- [x] `apps/api/src/modules/public/haversine.test.ts` (plan 08-01 Task 2) — 4 test xanh
- [x] `apps/api/src/modules/public/phone.test.ts` (plan 08-05 Task 3) — 11 test xanh
- [x] `apps/api/src/common/csrf-paths.test.ts` — khoá lỗ hổng CSRF `/api/public/*` (plan 08-07 Task 1) — 10 test xanh
- [x] `apps/api/src/modules/public/public-menu-shape.test.ts` — criterion (d) (plan 08-07 Task 3) — 9 test xanh
- [x] `apps/api/src/modules/public/public-orders.test.ts` — service + fake-repository cho 409 (plan 08-10 Task 1) — 19 test xanh
- [x] `apps/api/src/modules/public/open-order-lock.integration.test.ts` — MySQL thật, dùng thẳng `DataSource` (plan 08-10 Task 3) — 3 test xanh (gồm race 2 connection thật)
- [x] `apps/shop/src/lib/cart-store.test.ts` — D-06/D-07 (plan 08-06 Task 2) — 11 test xanh
- [x] `apps/shop/src/lib/maps-link.test.ts` — A3/SSRF (plan 08-12 Task 1) — 11 test xanh
- **Framework install:** `apps/api` không cần thêm gì (hướng nhẹ đã chốt); `apps/shop` thêm `vitest@^2.1.0` devDependency ở plan 08-06 Task 2

**Kết quả chạy thật (2026-07-31, plan 08-13 Task 2):**
```
pnpm -r typecheck                    → 5/5 project sạch
pnpm --filter @order/api test        → Test Files 10 passed (10), Tests 106 passed (106)
pnpm --filter @order/shop test       → Test Files 2 passed (2), Tests 22 passed (22)
pnpm --filter @order/shop build      → JS 356.06 kB / gzip 104.29 kB
sh scripts/check-shop-bundle.sh      → OK: bundle JS 348 kB (ngưỡng 370 kB); OK: 2 gate (chuỗi cấm + kích thước)
```
(Ghi chú thay thế lệnh: `pnpm` global trên máy này yêu cầu Node ≥22.13 trong khi máy đang chạy Node 20.11.0
— chạy qua `PATH="/opt/homebrew/opt/node@23/bin:$PATH" corepack pnpm ...`, đúng `packageManager: pnpm@9.0.0`
khai trong `package.json` gốc, không phải substitute khác lệnh.)

**Điều kiện tiên quyết để test được:** logic phải tách thành **hàm thuần nhận `nowMs` làm tham số**, không
đọc `Date.now()` bên trong. Đây là ràng buộc thiết kế, không phải gợi ý — nếu executor viết
`evaluateOrderingStatus()` đọc giờ hệ thống bên trong thì criterion (b) không test được mà không fake timer.
Áp dụng tương tự cho `endOfTodayIctMs(nowMs)` và `isCartExpired(savedAtMs, nowMs)`.

---

## Manual-Only Verifications

| Behavior | Requirement | Plan | Why Manual | Test Instructions |
|----------|-------------|------|------------|-------------------|
| BE trả 409 thật qua HTTP khi gọi API tay lúc công tắc OFF | REQ-K (criterion a) | 08-13 Task 3 bước 5-8 | Đã chốt không thêm `@nestjs/testing`+`supertest` — phần logic đã có test tự động, phần HTTP thật (guard + pipe + filter) chỉ verify qua dev server | Chạy `pnpm --filter @order/api dev`, tắt công tắc ở `/admin/settings`, rồi `curl -i -X POST http://localhost:3001/api/public/orders -H 'Content-Type: application/json' -H 'Origin: http://localhost:5174' -d '{...}'` → phải thấy `409` + `ONLINE_ORDERING_DISABLED`. Lặp lại với công tắc ON để xác nhận không chặn oan. |
| `POST /api/public/*` không có Origin bị chặn 403 | REQ-L (T-08-32) | 08-07 Task 1 · 08-13 Task 3 bước 9 | Middleware chạy ngoài tầng service; test hàm thuần chứng minh quyết định, không chứng minh middleware đã nối | `curl -i -X POST http://localhost:3001/api/public/orders -H 'Content-Type: application/json' -d '{}'` (không Origin) → `403 CSRF_ORIGIN_MISMATCH`; `curl -i http://localhost:3001/api/public/health -H 'Origin: https://evil.com'` → `200` |
| Docker image build được với `sharp` (dependency native đầu tiên của `apps/api`) | REQ-I (D-12) | 08-03 · ghi ở `08-UAT.md` test 1 | Máy dev không có Docker (`07-UAT.md` test 6). Lockfile cross-platform cần `pnpm.supportedArchitectures` | **Deferred UAT như phase 7**, nhưng là **GATE BẮT BUỘC TRƯỚC KHI DEPLOY PRODUCTION**, không chỉ trước khi đóng phase: `docker build -t order-api .` phải xong không lỗi, rồi chạy container và upload 1 ảnh thật qua trang quản lý menu xác nhận ra webp ~800px. |
| `Permissions-Policy: geolocation=(self)` serve thật trên `order.` | REQ-J (M2.D-69) | ghi ở `08-UAT.md` test 2 | Cần Caddy thật + HTTPS + domain thật; máy dev không có `caddy` CLI | Đã có trong `07-UAT.md` test 3. **Nếu header này sai thì nút "Chia sẻ vị trí" im lặng không chạy dù code đúng** — phải verify trước khi coi REQ-J là đạt trên production. |
| Geolocation trong WebView Zalo/Facebook (khách Việt hay bấm link từ Zalo) | REQ-J | ghi ở `08-UAT.md` test 3 | Không có tài liệu chính thức từ Zalo; chỉ suy luận từ pattern in-app browser | Mở link `order.<domain>` từ tin nhắn Zalo trên iPhone và Android thật, bấm "Chia sẻ vị trí". Nếu WebView chặn → xác nhận fallback (nhập địa chỉ tay + dán link Maps chứa toạ độ) hiển thị đúng và **vẫn đặt được hàng**. |

---

## Known Acceptance-Criteria Conflicts (ghi nhận, không sửa)

Phát hiện khi rà lại toàn phase ở plan 08-13 (waves 5-6 hoàn tất sau khi validation contract này được lập,
kèm 1 commit sửa UI ngoài phạm vi mọi plan). Đây là vấn đề **tài liệu**, không phải bug code — không "sửa"
bằng cách đổi mã lỗi hay đổi hành vi.

**`grep -ci "blacklist" apps/shop/src/pages/CheckoutPage.tsx` = 1, không phải 0 như acceptance criteria
gốc của plan 08-12 Task 3 yêu cầu.** Nguyên nhân: mã lỗi bắt buộc `'PHONE_BLACKLISTED'` (khớp enum
`ErrorCode` của `packages/schemas`, phải giữ nguyên literal để xử lý đúng 8 mã lỗi) chứa chuỗi con
`BLACKLIST`. 2 acceptance criteria của plan 08-12 ("8 mã lỗi xuất hiện dạng quoted literal" và "grep
blacklist = 0") mâu thuẫn nội tại khi cùng áp lên 1 file chứa đúng mã lỗi BE định nghĩa — không có cách
viết code nào thoả cả hai nếu vẫn dùng tên hằng số thật. D-21 (giọng văn trung tính, không nói "bị
chặn"/"blacklist" trong copy tiếng Việt hiển thị cho khách) **vẫn được tuân thủ đầy đủ**: không chuỗi tiếng
Việt nào trong `CheckoutPage.tsx` chứa "chặn"/"blacklist" — FE chỉ hiện nguyên văn `error.message` do BE
build (đã trung tính từ plan 08-10). Chi tiết đầy đủ ở `08-12-SUMMARY.md` § Deviations mục 2.

**Đã đánh giá nhưng KHÔNG cần entry `OVERRIDE-DEBT.md`** (không lệch quyết định LOCKED nào, chỉ là điều
chỉnh trong phạm vi hợp đồng đã có):
- Ngưỡng `MAX_JS_KB` trong `scripts/check-shop-bundle.sh` được nâng 2 lần (320 → 336 → 370 kB, hiện đo
  thật 348 kB) khi plan 08-11/08-12 thêm route/logic mới — `320 kB` ở plan 08-04 **không phải số spec-pin**,
  chỉ là ngân sách tự đặt = số đo thật lúc đó + margin; mỗi lần nâng đều ghi số đo thật + lý do trong chính
  script (không sửa lặng), đúng quy tắc tự đặt ban đầu.
- `field_errors?: {field,message}[]` thêm vào `ApiError` (`apps/shop/src/lib/use-api.ts`, plan 08-12) —
  không lệch spec, chỉ hoàn thiện việc đọc `field_errors` mà `ErrorEnvelope` (BE) vốn đã luôn trả cho
  `VALIDATION_FAILED` nhưng `parseErrorResponse()` cũ (plan 08-06) bỏ sót; thay đổi additive, không đổi chữ
  ký cũ.

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved — chủ dự án tự kiểm đủ 15 bước ở checkpoint plan 08-13 Task 3 và phản hồi "approved"
(2026-07-31), không báo bước nào sai. Người duyệt: chủ dự án (qua checkpoint `08-13-PLAN.md` Task 3).

⚠ Phạm vi approval này CHỈ áp cho 15 bước của Task 3 (luồng đặt hàng đầu-cuối + 4 lớp chống lạm dụng chạy
được ở local). **KHÔNG áp cho 5 hạng mục deferred UAT ở `08-UAT.md`** — đặc biệt test 1 (Docker build +
`sharp` trên alpine) vẫn là gate bắt buộc riêng, chưa nghiệm thu, phải xanh trước khi deploy production.
