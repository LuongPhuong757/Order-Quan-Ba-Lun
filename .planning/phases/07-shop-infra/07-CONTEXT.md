# Phase 7: Hạ tầng trang khách - Context

**Gathered:** 2026-07-29
**Status:** Ready for planning
**Source:** Ingest Express Path — dựng từ `.planning/intel/` (71 quyết định LOCKED từ `docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md`) thay cho `/gsd-discuss-phase`. Không cần hỏi lại user.

<domain>
## Phase Boundary

`apps/shop` phục vụ được như một app riêng trên hostname riêng (`order.<domain>`), dùng chung **1 API + 1 DB + 1 container** với trang quản lý, và code trang quản lý **không lọt** sang bundle của khách.

**Trong phạm vi:** static routing theo `Host`, build stage `shop-dist`, `ALLOWED_ORIGIN` dạng danh sách + so khớp host chính xác, site block Caddy cho `order.`, harness test đầu tiên của `apps/api`.

**Ngoài phạm vi:** mọi UI thật của trang khách (menu, checkout, tracking) — đó là phase 8/9. 4 trang trong `apps/shop/src/pages/` giữ nguyên dạng placeholder. Không tạo endpoint public mới ngoài `/api/public/health` đã có.

**LOCAL ONLY:** sửa `Caddyfile` / `Dockerfile` / `.env.*` nhưng **không** apply lên VPS, không deploy, không đụng DNS.
</domain>

<decisions>
## Implementation Decisions

### Static routing theo Host (M2.D-66)
- **D-01:** `main.ts` chọn thư mục static theo `Host` header: host bắt đầu bằng `order.` → `shop-dist`, còn lại → `web-dist`. Một container, một process.
- **D-02:** So khớp host phải **strip port** trước (`order.localhost:3001` → `order.localhost`) và lowercase, để test local bằng `curl -H "Host: order.localhost"` đi đúng nhánh.
- **D-03:** SPA fallback phải trả `index.html` của **đúng dist tương ứng host** — không được trả `web-dist/index.html` cho khách.
- **D-04:** Giữ nguyên điều kiện `NODE_ENV === 'production' && existsSync(dist)` như hiện tại. Dev vẫn dùng Vite dev server riêng (web 5173, shop 5174).
- **D-05 (ĐÃ SỬA 2026-07-29 — bản đầu SAI):** `apiPrefixes` (`main.ts`) **BẮT BUỘC** phải thêm `/api`.
  Giả định ban đầu ("Nest mount router trước middleware nên không cần") là **sai** — đã dựng lại được bằng curl:
  Nest đăng ký router trong `app.init()`, chạy bên trong `listen()`, tức **sau** mọi `app.use()` ở `bootstrap()`.
  Nên SPA fallback đứng **trước** router. Bằng chứng: `GET /health` (có trong list) trả JSON, còn
  `GET /api/public/health` (không có trong list) trả `index.html` **kể cả với `Accept: application/json`**.
  Đây là **bug production có sẵn từ Milestone 1**, không phải do M2 tạo ra; nó sẽ làm chết toàn bộ
  `/api/public/*` của phase 8–9 nếu không sửa. Đã sửa trong plan 07-01.

### Origin allow-list (M2.D-67 + C-SEC-01)
- **D-06:** `ALLOWED_ORIGIN` thành danh sách phân tách **dấu phẩy**. Parse: trim từng phần tử, bỏ phần tử rỗng, bỏ dấu `/` cuối.
- **D-07:** So khớp **chính xác** `protocol + '//' + host` qua `new URL()` — **bỏ hẳn** `origin.startsWith(allowed)` ở `csrf-origin.middleware.ts:35`. Lý do: `startsWith` để `https://quanbalun.site.evil.com` lọt qua.
- **D-08:** Tách logic thành **module thuần** (không phụ thuộc Nest/Express) để test được kiểu zero-config: `parseAllowedOrigins(raw)` + `isOriginAllowed(originOrReferer, list)`.
- **D-09:** `new URL()` ném lỗi với input rác → coi là **không hợp lệ → chặn**, không để throw ra ngoài middleware.
- **D-10:** Giữ nguyên `code: 'CSRF_ORIGIN_MISMATCH'` và phạm vi `pathRequiresCheck` hiện tại. Phase 7 **không** mở CSRF check sang `/api/public/*` — endpoint mutation công khai là việc của phase 8.

### Bundle isolation (M2.D-64)
- **D-11:** Nghiệm thu bằng grep chuỗi `/dashboard` và `/kitchen` trong **JS đã build** của `apps/shop/dist`, không phải trong source.
- **D-12:** Biến việc grep thành **script chạy lại được**, không phải thao tác tay một lần.

### Caddy site block (M2.D-69 + C-INFRA-03)
- **D-13:** Thêm site block riêng `order.{$DOMAIN}` — **không** gộp vào block apex bằng cách thêm hostname, vì hai bên cần `Permissions-Policy` khác nhau.
- **D-14:** Block `order.`: `Permissions-Policy "geolocation=(self), camera=(), microphone=()"`. Block apex **giữ** `geolocation=()`.
- **D-15:** Block `order.` thêm `Referrer-Policy "no-referrer"` — vì `order_token` là bearer credential nằm trong URL (C-INFRA-03). Spec không nói điều này; nếu làm đúng chữ sẽ rơi mất.
- **D-16:** Không thêm `www.order.` — chỉ `order.{$DOMAIN}`.

### Test harness (C-TEST-01)
- **D-17:** Zero-config vitest, theo đúng kiểu `apps/web/src/lib/menu-search.test.ts` đang có. **Không** tạo `vitest.config.ts`, **không** thêm jsdom (test đầu tiên là thuần Node).
- **D-18:** File test đặt cạnh source (`x.ts` + `x.test.ts`), không tạo thư mục `__tests__`.
- **D-19:** `describe`/`it` viết **tiếng Việt** theo C-CONV-01.
- **D-20:** Harness integration MySQL thật là việc của **phase 9** (M2.D-06 row lock, M2.D-01 doanh thu) — phase 7 chỉ dựng phần thuần.

### Claude's Discretion
- Tên chính xác của file/hàm trong module allow-list
- Cách tổ chức helper host-matching trong `main.ts` (inline vs tách file)
- Định dạng output của script kiểm bundle
- Thứ tự các header trong block Caddy mới

</decisions>

<specifics>
## Specific Ideas

- Chủ dự án chốt: *"toàn bộ M2 làm LOCAL ONLY — không deploy, không đụng VPS production"*. Sửa file hạ tầng thì được, apply thì không.
- `deploy.sh` đang untracked cố ý (đọc secret từ `.env.deploy` gitignore) — phase 7 **không** chạm vào nó.
- Spec dòng 659 ghi phase 07 "đã xong" là **sai** — mới xong scaffold. 5 việc còn lại chính là phase này.
- Ưu tiên bắt bug hạ tầng sớm: lý do tách phase 7 ra khỏi 8 là *"bắt sớm 3 bug hạ tầng đã phát hiện, trước khi đổ công vào UI"*.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Quyết định gốc
- `docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md` §Vòng 5 (M2.D-64..69) — 6 quyết định subdomain-infra
- `docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md` §12 (dòng 679–686) — checklist phase 07
- `.planning/intel/decisions.md` — 71 quyết định LOCKED, tiếng Việt verbatim
- `.planning/intel/requirements.md` § REQ-Q — acceptance criteria kèm trạng thái DONE/NOT DONE đã verify

### Ràng buộc
- `.planning/intel/constraints.md` § C-SEC-01 — CSRF phải so khớp host chính xác (mở rộng M2.D-67)
- `.planning/intel/constraints.md` § C-LOCAL-01 — LOCAL ONLY + 5 criteria deferred UAT
- `.planning/intel/constraints.md` § C-TEST-01 — thực trạng test harness
- `.planning/intel/constraints.md` § C-INFRA-02 — không CORS, same-origin là load-bearing
- `.planning/intel/constraints.md` § C-INFRA-03 — `order_token` là bearer credential trong URL
- `.planning/intel/constraints.md` § C-CONV-01 — quy ước code phải theo

### Bản đồ codebase
- `.planning/codebase/ARCHITECTURE.md:218` — vì sao endpoint mới phải nằm dưới `/api/*`
- `.planning/codebase/CONCERNS.md:46-56` — chi tiết lỗ prefix-spoofing
- `.planning/codebase/CONCERNS.md:64-68` — vì sao `Permissions-Policy` không kiểm được ở local
- `.planning/codebase/TESTING.md:8-36` — thực trạng test

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/web/src/lib/menu-search.test.ts` — mẫu test zero-config duy nhất trong repo; copy đúng kiểu này
- `apps/api` đã có `vitest ^2.1.0` + script `test: vitest run` — **không cần cài gì thêm**
- `packages/utils` (`apiOk`) — nơi đặt helper dùng chung nếu cần
- `apps/api/src/main.ts:35` — `useStaticAssets` cho `/uploads/` giữ nguyên, không liên quan host

### Established Patterns
- Pure ESM: import trong `apps/api` **phải** có đuôi `.js` kể cả khi file nguồn là `.ts`
- `GlobalExceptionFilter` bọc mọi `HttpException` thành envelope `{ code, message }` — middleware chỉ cần throw `ForbiddenException({ code, message })`
- Comment và `describe` viết tiếng Việt

### Integration Points
- `apps/api/src/main.ts:39-61` — khối serve static + SPA fallback, chỗ cần thành host-aware
- `apps/api/src/common/middleware/csrf-origin.middleware.ts:26,35` — chỗ đọc `ALLOWED_ORIGIN` và so khớp
- `Dockerfile:15,32,42,69` — 4 chỗ phải thêm `apps/shop` (manifest COPY, node_modules COPY, build, copy dist)
- `Caddyfile:5` — site block apex hiện tại, thêm block mới **bên dưới**
- `.env.example:25` — `ALLOWED_ORIGIN` single value. **`.env.production.example` hiện KHÔNG có key này** — phải thêm.

### Gotcha đã xác minh
- Route controller được Nest mount **trước** middleware `app.use` trong `bootstrap()`, nên `/api/public/*` luôn tới controller dù không có trong `apiPrefixes`. Đừng "sửa" bằng cách thêm `/api` vào list — vô hại nhưng gây nhầm lẫn về nguyên nhân.

</code_context>

<deferred>
## Deferred Ideas

- Harness integration MySQL thật (M2.D-06 row lock, M2.D-01 doanh thu) — **phase 9**
- Mở CSRF check sang `/api/public/*` cho endpoint mutation công khai — **phase 8**
- `Referrer-Policy` cấp UI (mask 4 ký tự đầu của `order_token` khi hiện) — **phase 9**, phase 7 chỉ làm phần header
- Chọn `fetch` vs thêm `axios` cho `apps/shop` (C-DEP-01) — **phase 8**, khi có data-fetching thật
- DNS + apply Caddy + kiểm cert — **deferred UAT**, chủ dự án tự làm sau milestone

</deferred>

---

*Phase: 07-shop-infra*
*Context gathered: 2026-07-29*
