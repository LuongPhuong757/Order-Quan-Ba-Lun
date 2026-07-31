---
phase: 08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n
plan: 13
subsystem: docs
tags: [override-debt, deferred-uat, validation, checkpoint]

requires:
  - phase: 08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n (plan 08-01..08-12)
    provides: toàn bộ luồng đặt hàng online + công tắc + anti-abuse đã thi công
provides:
  - "OVERRIDE-DEBT.md OD-06..OD-10 — 3 lệch spec đã biết trước (D-09/D-17/§5.2) + 2 lệch phát sinh giữa wave 5-6 (D-10/D-11)"
  - "08-UAT.md — 5 hạng mục deferred UAT phase 8, test 1 (Docker+sharp) là gate bắt buộc trước deploy production"
  - "08-VALIDATION.md phản ánh kết quả test thật (106 test apps/api + 22 test apps/shop, tất cả xanh) + Approval: approved (2026-07-31)"
  - "Checkpoint 15 bước — chủ dự án tự kiểm và gõ 'approved', không báo bước nào sai (2026-07-31)"
affects: [phase-09-approval-notification-tracking]

tech-stack:
  added: []
  patterns: []

key-files:
  created:
    - .planning/phases/08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n/08-UAT.md
  modified:
    - OVERRIDE-DEBT.md
    - .planning/phases/08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n/08-VALIDATION.md
    - .env (local, gitignored — không commit)

key-decisions:
  - "Thêm OD-09/OD-10 ngoài 3 entry OD-06/07/08 mà plan yêu cầu — phát hiện 2 lệch phát sinh thật (D-10 placeholder ảnh mất tên món, D-11 tỉ lệ khung ảnh 4/3→3/2) từ commit d31649c nằm giữa wave 5 và wave 6, ngoài phạm vi mọi plan 08-xx đã viết"
  - "Đánh giá nhưng KHÔNG thêm OVERRIDE-DEBT cho: nâng ngưỡng bundle 320→370kB (không phải số spec-pin, chỉ là ngân sách tự đặt), field_errors thêm vào ApiError (hoàn thiện hợp đồng đã có, không lệch spec)"
  - "Ghi nhận xung đột acceptance-criteria nội tại của plan 08-12 (PHONE_BLACKLISTED chứa 'BLACKLIST' nên grep -ci blacklist không thể =0) vào 08-VALIDATION.md thay vì OVERRIDE-DEBT.md — đây là vấn đề tài liệu/test tĩnh, không phải lệch quyết định LOCKED nào"
  - "Sửa .env cục bộ (gitignored): thêm http://localhost:5174/5183/5184 vào ALLOWED_ORIGIN + IP_HASH_SALT — Rule 3 (missing env var blocking), phát hiện khi chuẩn bị dev server cho checkpoint"

requirements-completed: [REQ-I, REQ-J, REQ-K, REQ-L]

duration: ~55min (Task 1+2 ~50min tự động; Task 3 chuẩn bị + chờ checkpoint, chủ dự án approved)
completed: 2026-07-31
---

# Phase 08 Plan 13: Đóng phase — OVERRIDE-DEBT, Deferred UAT, Checkpoint chủ dự án Summary

**Ghi đủ 5 override (3 đã biết + 2 phát sinh) vào `OVERRIDE-DEBT.md`, lập `08-UAT.md` với gate `sharp`/Docker bắt buộc trước deploy, cập nhật `08-VALIDATION.md` bằng kết quả test thật (106+22 test xanh), và chủ dự án đã tự kiểm 15 bước luồng đặt hàng đầu-cuối + 4 lớp chống lạm dụng — checkpoint APPROVED 2026-07-31, không báo bước nào sai.**

## Performance

- **Duration:** ~55 phút cho Task 1+2+3 (không tính thời gian chờ phản hồi người)
- **Started:** 2026-07-31 (giờ đọc file bắt đầu phiên)
- **Tasks:** 3/3 hoàn thành (Task 1, Task 2, Task 3 — checkpoint approved)
- **Files modified:** 3 file tài liệu (2 sửa, 1 tạo) + `.env` cục bộ (không commit)

## Accomplishments

- `OVERRIDE-DEBT.md`: 5 entry mới (OD-06..OD-10) — 3 entry đúng nguyên văn plan yêu cầu (D-09 `images[]`, D-17 tính-lúc-đọc không cron, §5.2 route admin không `/api`) + 2 entry tự phát hiện từ rà soát code thật sau wave 6 (D-10 placeholder ảnh bỏ tên món, D-11 tỉ lệ ảnh 4/3→3/2), mỗi entry đủ 7 mục theo khuôn file cũ.
- `08-UAT.md`: 5 hạng mục nghiệm thu production (Docker+sharp, `Permissions-Policy`, WebView Zalo/Facebook, ảnh cũ, bundle 3G), test 1 đánh dấu rõ **GATE BẮT BUỘC TRƯỚC KHI DEPLOY PRODUCTION**.
- `08-VALIDATION.md`: 12/12 dòng Per-Task Verification Map chuyển từ `⬜ pending` sang `✅ green` với số liệu test thật; `nyquist_compliant`/`wave_0_complete` = `true`; thêm mục "Known Acceptance-Criteria Conflicts" ghi nhận xung đột `PHONE_BLACKLISTED`/grep-blacklist của plan 08-12.
- Chạy lại toàn bộ automated verify của Task 3 — tất cả xanh (xem "Verification Output" bên dưới).
- Chuẩn bị 3 dev server đang chạy thật + dữ liệu copy-paste sẵn (menu_item_id thật, customer_token 64-hex, curl đã điền đủ) cho checkpoint.
- **Chủ dự án tự kiểm đủ 15 bước (luồng khách, chặn 2 lớp qua `curl`, 4 lớp chống lạm dụng, OFF-đến-hết-hôm-nay, đơn đang chạy không bị ảnh hưởng) và phản hồi "approved", không báo bước nào sai.**

## Task Commits

1. **Task 1: OD-06/07/08 + 2 entry phát sinh (OD-09/OD-10) vào OVERRIDE-DEBT.md** - `a4fb6d9` (docs)
2. **Task 2: 08-UAT.md + cập nhật 08-VALIDATION.md bằng kết quả thật** - `5d42b08` (docs)
3. **Task 3: chuẩn bị checkpoint (dev server + dữ liệu thật)** - `c065a6a` (docs); **kết quả "approved"** ghi lại ở `55b1e80` (docs) — checkpoint tự nó không sinh code, chỉ cập nhật `08-VALIDATION.md § Approval`, `08-UAT.md`, và Summary này.

**Plan metadata (STATE.md/ROADMAP.md, sequential mode):** commit theo sau khi checkpoint approved — xem `git log` (phase 8 đánh dấu Executed trong `ROADMAP.md`, `state.advance-plan` → `ready_for_verification`).

## Files Created/Modified

- `OVERRIDE-DEBT.md` - thêm OD-06..OD-10 (không sửa OD-01..05)
- `.planning/phases/08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n/08-UAT.md` - mới, 5 test deferred UAT
- `.planning/phases/08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n/08-VALIDATION.md` - File Exists/Status/frontmatter cập nhật, thêm mục Known Acceptance-Criteria Conflicts
- `.env` (gitignored, không commit) - thêm `http://localhost:5174,5183,5184` vào `ALLOWED_ORIGIN` + `IP_HASH_SALT`

## Decisions Made

Xem `key-decisions` ở frontmatter. Tóm tắt: giữ đúng nguyên văn 3 entry OD-06/07/08 plan yêu cầu, tự thêm 2 entry (OD-09/OD-10) cho 2 lệch phát sinh thật sau khi rà code, và **không** thêm entry cho 2 mục còn lại (ngưỡng bundle, `field_errors`) vì đánh giá kỹ cho thấy chúng không lệch quyết định LOCKED nào.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality / phát hiện ngoài phạm vi 08-13 gốc] `OVERRIDE-DEBT.md` cần thêm 2 entry (OD-09/OD-10) ngoài 3 entry plan yêu cầu**
- **Found during:** Task 1, khi đối chiếu `important_context` của prompt điều phối với `08-CONTEXT.md` D-10/D-11 và commit `d31649c`.
- **Issue:** Wave 5-6 hoàn tất sau khi plan 08-13 được viết; 1 commit sửa UI (`d31649c`, "fix(shop): sửa card món vỡ...") thay đổi 2 hành vi đã LOCKED (D-10: placeholder ảnh có tên món; D-11: `aspect-ratio: 4/3`) mà không có entry nào trong `OVERRIDE-DEBT.md`, để lại "override im lặng" — đúng threat T-08-73 mà plan này phải đóng.
- **Fix:** Thêm OD-09 (placeholder bỏ tên món, lý do: tránh in tên 2 lần khi `CardItem.tsx` đã có `<h3>`) và OD-10 (tỉ lệ ảnh 4/3→3/2, lý do: 4/3 làm desktop chỉ thấy 1 hàng món) với đủ 7 mục theo khuôn file.
- **Files modified:** `OVERRIDE-DEBT.md`
- **Verification:** `grep -c "^## OD-09" OVERRIDE-DEBT.md` = 1, `grep -c "^## OD-10" OVERRIDE-DEBT.md` = 1, `grep -c "Quay lại thì sao" OVERRIDE-DEBT.md` = 9 (≥ 8 yêu cầu)
- **Committed in:** `a4fb6d9`

**2. [Rule 3 - Blocking] `.env` cục bộ thiếu origin `apps/shop` trong `ALLOWED_ORIGIN` — chặn oan mọi request thật từ trang khách**
- **Found during:** Task 3, khi chuẩn bị dev server để soạn curl thật cho checkpoint.
- **Issue:** `.env` (gitignored, không phải file mẫu) chỉ có `ALLOWED_ORIGIN=http://localhost:5173` — thiếu `5174` (port mặc định `apps/shop`). Nếu không sửa, mọi curl bước 7/8 của checkpoint (mong đợi `409`) sẽ nhận nhầm `403 CSRF_ORIGIN_MISMATCH`, làm bước 9 (test CSRF) và bước 7/8 (test guard công tắc) không phân biệt được nguyên nhân thất bại.
- **Fix:** Thêm `http://localhost:5174,http://localhost:5183,http://localhost:5184` vào `ALLOWED_ORIGIN` (2 port sau là port thật dùng cho dev server checkpoint này, xem "Issues Encountered"), thêm `IP_HASH_SALT` theo đúng `.env.example` (có fallback code nếu thiếu, thêm cho nhất quán). Không sửa `.env.example` (đã đúng sẵn từ phase 7 với 2 origin mặc định).
- **Files modified:** `.env` (không commit — gitignored)
- **Verification:** `curl -i -X POST .../api/public/orders -H 'Origin: http://localhost:5184' -d '{}'` → `400` (validation, đã qua được CSRF) thay vì `403`
- **Committed in:** không commit (file gitignored theo thiết kế)

---

**Total deviations:** 2 auto-fixed (1 Rule 2 — thêm override thiếu, 1 Rule 3 — sửa env blocking). Không có Rule 4 (không cần hỏi lại kiến trúc).
**Impact on plan:** Không scope creep — cả 2 đều là việc "phải làm" để phase đóng đúng nghĩa "không override im lặng" và để checkpoint chạy đúng như thiết kế.

## Issues Encountered

- **Port 5173/5174 (mặc định `apps/web`/`apps/shop`) đang bị chiếm bởi dev server của `OrderQuanBaLun-main`** (worktree khác, nhánh `main`, theo đúng setup song song đã ghi ở memory người dùng) — 2 tiến trình đó không phải của phase 8, không an toàn để kill (giống quyết định của 08-04/08-12 trước đó). Đã khởi động 2 dev server của **nhánh `feat/online-ordering` (repo này)** ở port thay thế:
  - `apps/web` (quản lý) → **http://localhost:5183/** (thay vì 5173)
  - `apps/shop` (khách) → **http://localhost:5184/** (thay vì 5174, `--strictPort` giữ nguyên qua cờ CLI)
  - `apps/api` → **http://localhost:3001/** (port gốc, đã free và khởi động lại sau khi sửa `.env`)
  - Đã thêm cả 2 port thay thế vào `ALLOWED_ORIGIN` cục bộ để CSRF không chặn oan.
- Không tự chạy bất kỳ curl mutating nào (không tự tắt công tắc, không tự đặt SĐT vào blacklist, không tự đổi giờ mở cửa) — toàn bộ phần đó là việc của chủ dự án ở checkpoint. Chỉ chạy 1 lệnh `curl` thăm dò với body `{}` (400 validation, không ghi DB) để xác nhận origin đã hết bị chặn CSRF trước khi giao checkpoint — đã xác nhận `online_order_requests` vẫn 0 dòng sau lệnh đó.

## Verification Output (Task 3 automated `<verify>`)

```
$ pnpm -r typecheck
Scope: 5 of 6 workspace projects
packages/utils typecheck: Done
packages/schemas typecheck: Done
apps/shop typecheck: Done
apps/api typecheck: Done
apps/web typecheck: Done
(exit 0)

$ pnpm --filter @order/api test
 Test Files  10 passed (10)
      Tests  106 passed (106)
   Duration  1.48s
(exit 0)

$ pnpm --filter @order/shop test
 Test Files  2 passed (2)
      Tests  22 passed (22)
   Duration  259ms
(exit 0)

$ pnpm --filter @order/shop build && sh scripts/check-shop-bundle.sh
dist/assets/index-7y08XdPm.js   356.06 kB │ gzip: 104.29 kB
OK: bundle JS 348 kB (ngưỡng 370 kB)
OK: bundle khách sạch — đã kiểm 2 gate (đã kiểm 11 chuỗi cấm + kích thước JS trong apps/shop/dist)
(exit 0)
```

(Ghi chú lệnh: `pnpm` global trên máy yêu cầu Node ≥22.13, máy đang Node 20.11.0 — chạy qua
`PATH="/opt/homebrew/opt/node@23/bin:$PATH" corepack pnpm ...`, khớp `packageManager: pnpm@9.0.0` khai
trong `package.json` gốc, không phải lệnh khác.)

## User Setup Required

**Không cần cấu hình dịch vụ ngoài nào mới.** 3 dev server đã được khởi động cho checkpoint (`api:3001`,
`web:5183`, `shop:5184`) và đã được **dừng lại** sau khi chủ dự án kiểm xong — không còn tiến trình nào
của phase 8 chạy nền.

## Checkpoint Result

**"approved"** — chủ dự án tự tay chạy đủ 15 bước ở `<how-to-verify>` của `08-13-PLAN.md` Task 3 (luồng
khách A.1-4, chặn 2 lớp qua `curl` B.5-9, 4 lớp chống lạm dụng C.10-13, OFF-đến-hết-hôm-nay D.14, đơn đang
chạy không bị ảnh hưởng E.15), **không báo bước nào sai**. Đã cập nhật:
- `08-VALIDATION.md § Approval`: `pending` → **`approved`** (2026-07-31, người duyệt: chủ dự án qua
  checkpoint `08-13-PLAN.md` Task 3), kèm chú thích rõ phạm vi approval chỉ áp cho 15 bước local, không
  áp cho 5 hạng mục deferred UAT.
- `08-UAT.md`: thêm ghi chú phân biệt rõ approval này KHÔNG áp cho 5 hạng mục deferred production —
  **cả 5 vẫn `result: pending`**, `status: testing` giữ nguyên, không hạng mục nào bị đánh dấu xong.

## Next Phase Readiness

- **Phase 8 đã đóng chính thức** — 13/13 plan có SUMMARY, 106+22 test xanh, `08-VALIDATION.md § Approval` =
  `approved`. Phase 9 (REQ-M/N/O — duyệt đơn, thông báo, theo dõi đơn) không còn blocker kỹ thuật nào từ
  phase 8 để bắt đầu.
- **Việc còn treo sau phase 8 (không phải blocker của phase 9, nhưng bắt buộc trước khi deploy production
  thật):** 5 hạng mục `08-UAT.md`, đặc biệt **test 1 (Docker build + `sharp` trên alpine) là gate bắt buộc
  riêng** — máy dev không có Docker, chưa từng build image thật với `sharp`. 4 hạng mục còn lại (Permissions-
  Policy geolocation, WebView Zalo/Facebook, ảnh cũ, bundle 3G thật) cũng chưa nghiệm thu, cùng nhóm với 7
  hạng mục deferred của `07-UAT.md` (DNS, TLS, Caddy...).
- 2 lệch spec mới phát hiện (OD-09/OD-10, từ 1 commit UI ngoài phạm vi mọi plan) đã ghi đủ vào
  `OVERRIDE-DEBT.md` — không cần hành động thêm.

## Self-Check: PASSED

- FOUND: OVERRIDE-DEBT.md (chứa OD-09, OD-10)
- FOUND: .planning/phases/08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n/08-UAT.md (5/5 test vẫn `result: pending`, không bị đánh dấu xong)
- FOUND: .planning/phases/08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n/08-VALIDATION.md (nyquist_compliant: true, § Approval: approved)
- FOUND commit: a4fb6d9
- FOUND commit: 5d42b08
- FOUND commit: c065a6a
- `pnpm -r typecheck` / `pnpm --filter @order/api test` / `pnpm --filter @order/shop test` / bundle guard — đều exit 0 (dán nguyên văn ở trên)
- 3 dev server khởi động cho checkpoint đã được dừng (xác nhận `lsof -iTCP:3001,5183,5184` rỗng)

---
*Phase: 08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n*
*Completed: 2026-07-31 — checkpoint approved, phase 8 đóng*
