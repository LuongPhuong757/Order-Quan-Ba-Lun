# Context notes (DOC-layer)

> All entries from `docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md` unless stated otherwise.
> Vietnamese kept verbatim where it carries owner intent.

---

## Topic: milestone goal

- source: `...SPEC.md:11-13`
- Verbatim: "Cho khách hàng tự đặt món từ xa qua web công khai (không cần login), đơn phải được **admin xác nhận**
  trước khi vào bếp. Khách theo dõi tiến độ bằng **% tổng** (không lộ món nào đã xong). Quán có công tắc
  **ON/OFF nhận đơn** và hệ thống thông báo nhiều lớp để không bỏ lọt đơn."
- Continues Milestone 1 (internal POS). Feature branch: `feat/online-ordering` (spec:7) — already merged into `main`
  per project memory (2026-07-29).

## Topic: success criteria set by the owner (G-1..G-4)

- source: `...SPEC.md:15-22`
- **G-1** — Khách order từ xa có trải nghiệm tốt nhất; chỉ thấy **% tổng số món đã xong**, không thấy món cụ thể
  (tránh khách sốt ruột → huỷ). Measure: trang tracking chỉ render % + 5 mốc trạng thái.
- **G-2** — Admin biết có đơn mới sớm nhất có thể. Measure: p95 độ trễ thông báo < 5s; tỉ lệ đơn bị bỏ quên > 5 phút = 0.
- **G-3** — Giao diện giữ khách ở lại lâu để chọn món. Measure: thời gian trung bình trên trang menu; tỉ lệ rời trang ở bước 1.
- **G-4** — Thống kê số người truy cập + số người đặt món. Measure: dashboard phễu 5 bước, cập nhật hằng ngày.
- Note: G-1 has one deliberate exception — cancelled items MUST be disclosed (M2.D-21), because hiding a cancellation
  "là lừa khách".

## Topic: phase breakdown (4 phases, post-vòng-5 numbering)

- source: `...SPEC.md:537-620`
- **Phase 07 — Hạ tầng trang khách: `apps/shop` + subdomain** (Size M, new in vòng 5). Depends on: none. REQ-Q.
  Rationale for splitting it out: "Tách riêng để bắt sớm 3 bug hạ tầng đã phát hiện, trước khi đổ công vào UI."
- **Phase 08 — Public Menu, Checkout & Công tắc nhận đơn** (Size L, formerly 07). Depends on: 02 (menu), 03 (bàn),
  07. REQ-I, REQ-J, REQ-K, REQ-L.
- **Phase 09 — Duyệt đơn, Thông báo & Theo dõi đơn** (Size L, formerly 08). Depends on: 04 (order lifecycle), 08.
  REQ-M, REQ-N, REQ-O.
- **Phase 10 — Analytics & Phễu chuyển đổi** (Size S, formerly 09). Depends on: 08, 09. REQ-P.
- The doc header still says "3 phase (07, 08, 09)" (spec:6) — stale, §9 is authoritative (see INFO conflict).

## Topic: what is already built (verified against the tree, 2026-07-29)

- source: `...SPEC.md:659` + direct codebase inspection
- Spec claim: "phase 07 đã dựng `apps/shop` + `packages/utils` + 4 trang placeholder + `GET /api/public/health`."
- Verified DONE: `apps/shop` exists (Vite + React, port 5174 strict) with 4 placeholder pages
  (`CartPage`, `CheckoutPage`, `HistoryPage`, `OrderTrackPage`); `packages/utils` with `apiOk`;
  `GET /api/public/health` at `apps/api/src/modules/public/public.controller.ts:48`.
- Verified NOT DONE (still open, all part of REQ-Q): Host-based static routing in `main.ts` (only `web-dist` mounted,
  line 39); `shop-dist` build stage in `Dockerfile` (no `shop` reference); `ALLOWED_ORIGIN` as a list
  (`.env.example:25` is a single value and the middleware still does `startsWith`); Caddy `order.{$DOMAIN}` site block
  with `geolocation=(self)` (`Caddyfile:23` has one block, `geolocation=()`); DNS A record.
- Practical read: phase 07 is roughly 1/3 complete — the scaffold landed, the infra plumbing did not.

## Topic: risks & mitigations (owner-reviewed)

- source: `...SPEC.md:624-635`
- Đơn chưa duyệt lọt vào doanh thu / bếp — **Cao** → M2.D-01 bảng riêng loại rủi ro về mặt cấu trúc; vẫn phải có test đếm doanh thu.
- Response tracking leak status từng món (vỡ G-1) — **Cao** → assert trong test + reviewer chặn PR (M2.D-23).
- Tự tạo bàn không kiểm soát → sơ đồ bàn rác — Trung bình → audit log mỗi lần tạo; admin gộp/ẩn bàn thủ công; cảnh báo khi > 10 bàn ship active.
- SMS tốn phí ngoài dự kiến — Trung bình → SMS chỉ ở L2 sau 90s; theo dõi số tin/ngày; Web Push miễn phí để giảm phụ thuộc.
- Race cấp bàn khi 2 admin duyệt cùng lúc — Trung bình → transaction + `FOR UPDATE` + `runWithRetry` + test song song.
- Auto-OFF làm mất đơn ngoài giờ cao điểm — Trung bình → ngưỡng là setting; SMS đã bắn trước; audit log actor SYSTEM.
  (Note: the mitigation text says "SMS đã bắn trước đó 3.5 phút", which is arithmetic from the old 300s threshold;
  under M2.D-60/1800s the gap is 28.5 phút. Harmless prose staleness.)
- iOS Safari xoá localStorage sau ~7 ngày — Thấp → đã chấp nhận mất lịch sử (M2.D-10).
- Khách gửi toạ độ sai / từ chối chia sẻ vị trí — Thấp → fallback text quy tắc phí (M2.D-51); phí cuối do admin chốt.

## Topic: open items — explicitly NOT blocking phases 07/08

- source: `...SPEC.md:639-648` (8 items, verbatim intent preserved)
1. **Web Push (VAPID)** và **Telegram bot** — miễn phí, độ trễ 2–5s, về được máy khi tắt web. Adapter M2.D-37 nên thêm sau là 1 file. Web Push trên iPhone cần "Thêm vào màn hình chính" (PWA).
2. **Đo khoảng cách chính xác** — nếu Haversine × 1.3 sai quá nhiều, chuyển OSRM self-host (miễn phí) hoặc Google Distance Matrix (tốn phí).
3. **Ngưỡng `free_ship_km`** — spec mặc định 10 km. Chủ quán nói "4–10 km miễn phí, xa hơn thu phí" → hiểu là **miễn phí đến 10 km**. Sửa ở `/admin/settings`, xác nhận lại khi làm phase 08.
4. **Gọi tự động (voice call)** ở lớp L5 nếu SMS vẫn bị bỏ lọt — chưa cần.
5. **Gộp bàn ship tự tạo** — nếu sơ đồ phình to, cân nhắc tự ẩn bàn ship rỗng.
6. **Màu thương hiệu Quán Bà Lùn** — cần logo quán để chốt màu chính thay đỏ coral Lotteria.
7. **Ảnh design ref bản mobile** — thiếu 2 ảnh quan trọng nhất, `docs/design-refs/lotteria/` chưa tạo.
8. **Thanh toán online** — M2.D-58 chốt COD; cột `payment_method` để ngỏ cho VietQR/chuyển khoản sau.
- Caveat: items 6 and 7 are listed as non-blocking here, but M2.D-71 says the missing screenshots must be captured
  **before** phase 08 UI work. Surfaced as a WARNING in the conflicts report.

## Topic: design reference provenance

- source: `...SPEC.md:145-204`
- Reference site: https://www.lotteria.vn (owner's choice). Two screens supplied 2026-07-29:
  `lotteria.vn/category/set` (item grid) and `lotteria.vn/cart` (cart). Missing: homepage/banner, item detail,
  checkout step 2, **and the mobile versions** — mobile is called out as the single biggest risk since
  "khách gần như 100% vào bằng điện thoại".
- Deliberate deviations from Lotteria: drop the account icon (no login) → "Đơn của tôi" → `/history`; rename checkout
  step 2 to "Thông tin nhận hàng" (no online payment); drop the "Tùy chọn" utensils card; drop the PII-consent
  checkbox, replaced by "Thông tin của bạn chỉ dùng để giao đơn này."; no strikethrough prices / combos / coupons
  (quán has no promotions), but "Bán chạy" is derivable from real sales data.

## Topic: tooling / process history

- source: `...SPEC.md:652-675`, project memory
- 2026-07-29: VGFlow removed, GSD adopted. All `.vg/` artifacts (ROADMAP, REQUIREMENTS, phase 07/08 PLAN + PROGRESS)
  were deleted from the working tree; recoverable only via `git show <commit>:.vg/ROADMAP.md`. Phase planning is being
  redone in `.planning/` with GSD.
- Consequence: every `.vg/...` cross-reference in the spec is a dangling link on disk. This matters most for Phase 07,
  whose success criteria the spec delegates entirely to `.vg/ROADMAP.md § Phase 07` (spec:546) — see WARNING.
- Intended flow per the spec: `/gsd:new-milestone` → per phase `/gsd:discuss-phase` → `/gsd:plan-phase` →
  `/gsd:execute-phase` → `/gsd:verify-work`; UI phases need design refs in `docs/design-refs/lotteria/` first, then
  `/gsd:ui-phase` to generate `UI-SPEC.md`.
- Override bookkeeping: the spec requires both self-overrides (M2.D-59, M2.D-60) to be recorded in `OVERRIDE-DEBT.md`
  (spec:28, :134). That file does not exist in the repo — nothing enforces it today.

## Topic: user mandate layered on top of the spec

- source: ingest prompt (user), project memory
- **All Milestone 2 work is LOCAL ONLY.** No deploys, no pushes, no touching the production VPS. Production-dependent
  acceptance (DNS, Caddy cert, `Permissions-Policy` via Caddy, host-only cookie across two real hostnames) is deferred
  UAT — see `constraints.md` C-LOCAL-01. This overrides the spec's implicit assumption that phase 07 ends with a
  working `order.` subdomain in production.
