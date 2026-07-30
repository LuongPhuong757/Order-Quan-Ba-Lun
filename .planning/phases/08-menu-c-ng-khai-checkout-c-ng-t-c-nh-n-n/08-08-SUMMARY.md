---
phase: 08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n
plan: 08
subsystem: ui
tags: [react, react-router-dom, admin-panel, apps-web]

# Dependency graph
requires:
  - phase: 08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n
    provides: "GET/PUT /admin/settings + GET/POST/DELETE /admin/phone-blacklist (plan 08-05)"
provides:
  - "Trang /admin/settings (apps/web) với 2 tab: Nhận đơn & giờ mở cửa, Số điện thoại bị chặn"
  - "Widget công tắc nhận đơn 1 chạm ở DashboardPage"
  - "Route /admin/settings dưới RoleGate allow={['admin']}"
affects: [phase-09-thong-bao]

tech-stack:
  added: []
  patterns:
    - "Tab qua ?tab= query param (mượn AdminAuditPage), không route riêng cho blacklist (D-14)"
    - "Giờ mở cửa dạng mặc định + ngoại lệ theo thứ (D-15), collapse/expand ở BE (08-05)"
    - "Màu hardcode inline theo convention apps/web hiện có (D-16), không tokens.css"

key-files:
  created:
    - apps/web/src/pages/AdminSettingsPage.tsx
  modified:
    - apps/web/src/App.tsx
    - apps/web/src/pages/DashboardPage.tsx

key-decisions:
  - "Widget Dashboard toggle dựa trên ordering_status.enabled (computed, factor cả giờ mở cửa), không phải raw online_ordering_enabled — khớp nguyên văn spec 'PUT với online_ordering_enabled: <đảo>'; trường hợp OUTSIDE_HOURS bấm nút chỉ re-confirm true (no-op an toàn), không có cách ép mở ngoài giờ từ widget — đúng chủ ý D-17 (manual không thắng được giờ mở cửa)"
  - "BlacklistTab nhận q/page/onUpdateParam làm props từ AdminSettingsPage thay vì tự gọi useSearchParams() riêng — giữ nguồn sự thật URL params ở 1 chỗ"

requirements-completed: [REQ-K, REQ-L]

duration: 45min
completed: 2026-07-30
---

# Phase 8 Plan 08: AdminSettingsPage + Widget công tắc Dashboard Summary

**Trang `/admin/settings` 2 tab (công tắc/giờ mở cửa/giao hàng + blacklist SĐT) và widget bật/tắt nhận đơn 1 chạm ở Dashboard, theo đúng pattern hardcode-màu hiện có của `apps/web`.**

## Performance

- **Duration:** ~45 min
- **Completed:** 2026-07-30T07:36:09Z
- **Tasks:** 3/3
- **Files modified:** 3 (1 tạo mới, 2 sửa)

## Accomplishments
- Trang `AdminSettingsPage.tsx` (722 dòng) với 2 tab qua `?tab=ordering|blacklist`:
  công tắc nhận đơn (bật ngay / tắt kèm chọn kiểu MANUAL/UNTIL_TOMORROW + lý do),
  giờ mở cửa dạng mặc định + ngoại lệ theo thứ (D-15, validate `from < to`),
  khối giao hàng & liên hệ (SĐT, `free_ship_km`, `distance_factor`, toạ độ, ETA),
  và tab blacklist SĐT (thêm/xoá/lọc/phân trang, xác nhận trước khi xoá).
- Widget 1 chạm ở `DashboardPage` đổi trạng thái nhận đơn ngay, không modal, không hỏi lý do (D-13).
- Route `/admin/settings` nằm trong đúng block `RoleGate allow={['admin']}` cùng `/admin/users`, `/admin/audit`.

## Task Commits

Each task was committed atomically:

1. **Task 1: AdminSettingsPage — tab "Nhận đơn & giờ mở cửa"** - `9af1041` (feat)
2. **Task 2: AdminSettingsPage — tab "Số điện thoại bị chặn"** - `b0b9fc7` (feat)
3. **Task 3: Route /admin/settings + widget công tắc 1 chạm ở Dashboard** - `ba1178e` (feat)

**Plan metadata:** (commit theo sau, do orchestrator quản STATE.md/ROADMAP.md)

## Files Created/Modified
- `apps/web/src/pages/AdminSettingsPage.tsx` - Trang cài đặt 2 tab, gọi `/admin/settings` + `/admin/phone-blacklist`
- `apps/web/src/App.tsx` - Thêm import + `<Route path="/admin/settings">` vào block admin-only
- `apps/web/src/pages/DashboardPage.tsx` - Thêm `OrderingWidget` (1 chạm), bỏ khối "Thông tin phase 01"

## Decisions Made
- Widget Dashboard dùng `ordering_status.enabled` (giá trị đã tính cả giờ mở cửa) để quyết định nhãn nút và hướng đảo trạng thái — khớp nguyên văn plan ("PUT với `online_ordering_enabled: <đảo>`"). Hệ quả: khi đang "Ngoài giờ mở cửa", bấm nút chỉ gửi lại `{ enabled: true }` (đã đúng, no-op an toàn) — widget không có cách ép mở ngoài giờ cấu hình, đúng tinh thần D-17 (manual switch không thắng được giờ mở cửa, phải sửa giờ ở `/admin/settings`).
- Chuyển state `q`/`page` của tab blacklist lên component cha (`AdminSettingsPage`) và truyền xuống qua props thay vì gọi `useSearchParams()` lần thứ hai trong `BlacklistTab` — giữ URL params ở một nguồn duy nhất.

## Deviations from Plan

None (Rule 1-4) - plan điều hành đúng như thiết kế, không phát sinh bug/chức năng thiếu/kiến trúc mới.

### Ghi chú không phải deviation — sai số trong acceptance criteria của chính PLAN.md

Tiêu chí `grep -c "useSearchParams" apps/web/src/pages/AdminSettingsPage.tsx = 1` không thể đạt được
đúng nghĩa đen khi tuân thủ pattern BẮT BUỘC (mẫu `AdminAuditPage.tsx` mà plan yêu cầu làm theo).
`grep -c` đếm số **dòng** khớp, không phải số lần xuất hiện; import (`import { useSearchParams }...`)
và lời gọi (`const [params, setParams] = useSearchParams();`) luôn nằm 2 dòng riêng biệt →
kết quả tối thiểu là 2. Đã kiểm chứng ngay trên file mẫu `AdminAuditPage.tsx` (chính plan trích dẫn
làm khuôn mẫu bắt buộc): `grep -c "useSearchParams" AdminAuditPage.tsx` = 2, không phải 1.
Kết quả thực tế của `AdminSettingsPage.tsx`: **2** (đúng bằng file mẫu, đúng pattern D-16 yêu cầu).
Tất cả acceptance criteria khác của cả 3 task đã verify đạt đúng số/điều kiện ghi trong PLAN.md
(xem mục "Self-Check" bên dưới).

## Issues Encountered

Worktree base bị lệch khỏi commit chỉ định (`worktree_branch_check` phát hiện HEAD gốc ở
`adbd758` thay vì `3840b67`) — đã tự sửa bằng `git reset --hard 3840b671014d53ca05ea4a87feb6d2ceb4b14a18`
đúng theo hướng dẫn `<worktree_branch_check>` trước khi bắt đầu bất kỳ thay đổi nào. Không ảnh hưởng
tới nội dung 3 commit của plan này.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `/admin/settings` sẵn sàng cho admin thao tác thật: đặt kiểu OFF, giờ mở cửa, thông tin giao hàng,
  và quản lý blacklist SĐT — phase 9 (thông báo) có thể dựa vào `ordering_status`/`settings` đã có sẵn.
- Kiểm tay còn thiếu (không tự động hoá được trong môi trường dev hiện tại — không có server backend
  chạy sẵn trong worktree để gọi `curl http://localhost:3001/api/public/store`): các mục "Kiểm tay"
  trong PLAN.md (tắt 1 chạm phản ánh ra `/api/public/store`, đăng nhập role `order` bị chặn, đổi giờ
  mở cửa rồi reload xem lại đúng 1 dòng mặc định + ngoại lệ). Đã verify được bằng đọc code + typecheck +
  build + bundle-guard; cần QA thủ công với backend chạy thật trước khi release.

## Self-Check: PASSED

- FOUND: apps/web/src/pages/AdminSettingsPage.tsx
- FOUND commit: 9af1041 (Task 1)
- FOUND commit: b0b9fc7 (Task 2)
- FOUND commit: ba1178e (Task 3)
- `corepack pnpm --filter @order/web typecheck` — sạch
- `corepack pnpm --filter @order/web build` — OK
- `corepack pnpm --filter @order/shop build && sh scripts/check-shop-bundle.sh` — OK (244 kB / 320 kB ngưỡng)
- Không có file `tokens.css` mới trong `apps/web`
- Không sửa `apps/api`, `package.json`, `pnpm-lock.yaml` (xác nhận qua `git diff --name-only` so với base)

---
*Phase: 08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n*
*Completed: 2026-07-30*
