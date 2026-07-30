---
phase: 08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n
plan: 09
subsystem: ui
tags: [react, vite, zod, apps-shop, menu, public-facing]

requires:
  - phase: 08-06
    provides: use-api.ts (fetch thuần + zod parse), cart-store.ts (localStorage cart, applyMenuSync, formatVnd)
  - phase: 08-07
    provides: GET /api/public/menu, GET /api/public/store (whitelist 7 field/món, 11 field trạng thái quán)
  - phase: 08-04
    provides: AppShell, Header (ghi query `q`), router apps/shop
provides:
  - Trang menu công khai hoàn chỉnh (lưới món, dải danh mục, tìm kiếm, banner trạng thái, thêm giỏ)
  - CardItem.tsx + ImagePlaceholder.tsx (card món, món hết hàng làm mờ không ẩn, placeholder gỗ)
  - CategoryRail.tsx (dải danh mục sticky, dot pagination mobile)
  - BannerNotice.tsx (component dùng chung 3 tone cho 4 tình huống banner)
affects: [08-10, phase-09-order-tracking]

tech-stack:
  added: []
  patterns:
    - "CSSProperties object ở module scope đọc var(--...) — nối tiếp khuôn Wordmark.tsx cho mọi component apps/shop mới"
    - "opacity 1 style const áp 2 lần (image + body) thay vì bọc toàn card — giữ literal token 1 lần trong source nhưng dim đúng 'toàn bộ nội dung trừ chip'"
    - "BannerNotice branch role='alert'/'status' bằng 2 nhánh JSX literal thay vì role động — dễ kiểm tĩnh bằng grep, ARIA đúng ngay lần render đầu"
    - "CategoryRail sticky top tính hoàn toàn bằng calc(var(--safe-top) + var(--sp-3) * 2 + var(--tap-min)) thay vì đo Header bằng JS"

key-files:
  created:
    - apps/shop/src/components/ImagePlaceholder.tsx
    - apps/shop/src/components/CardItem.tsx
    - apps/shop/src/components/CategoryRail.tsx
    - apps/shop/src/components/BannerNotice.tsx
  modified:
    - apps/shop/src/pages/MenuPage.tsx

key-decisions:
  - "CardItem dim cả vùng ảnh và vùng tên/giá bằng 1 const `dimmed` dùng lại 2 lần, chip Hết hàng đặt ngoài 2 vùng đó nên luôn opacity 1"
  - "CategoryRail: khi chọn 1 nhóm cụ thể chỉ hiện đúng nhóm đó (không heading); khi 'Tất cả' hiện toàn bộ nhóm có heading — giữ cảm giác duyệt menu đầy đủ đúng REQ-I"
  - "BannerNotice.action.href là SỐ ĐIỆN THOẠI thô (không phải URL), component tự dựng liên kết gọi 1 chạm — tránh mỗi nơi gọi phải tự nhớ tiền tố"

patterns-established:
  - "Skeleton loading: animate CHỈ opacity qua @keyframes trong <style> tag, bọc @media (prefers-reduced-motion: reduce) tắt animation"
  - "Tìm kiếm bỏ dấu: normalize('NFD').replace(/\\p{Diacritic}/gu,'').toLowerCase() — dùng lại cho mọi ô tìm kiếm apps/shop sau này"

requirements-completed: [REQ-I, REQ-K]

duration: 25min
completed: 2026-07-30
---

# Phase 8 Plan 09: Trang Menu công khai hoàn chỉnh Summary

**Trang `/` của `apps/shop` dựng đầy đủ: lưới món auto-fill responsive không media query, dải danh mục sticky cuộn ngang + dot pagination mobile, tìm kiếm bỏ dấu client-side, banner trạng thái quán (OFF/ngoài giờ/lỗi tải/giá đổi), món hết hàng làm mờ giữ nguyên trong lưới, và nút thêm giỏ hoạt động qua `useCart`.**

## Performance

- **Duration:** ~25 phút (từ commit đầu tới cuối)
- **Started:** 2026-07-30T14:54:44+07:00
- **Completed:** 2026-07-30T15:10:45+07:00
- **Tasks:** 3/3 hoàn thành
- **Files modified:** 5 (4 mới, 1 sửa)

## Accomplishments

- Khách xem toàn bộ menu ở `/` không cần đăng nhập, không bị hỏi thông tin cá nhân nào (M2.D-08) — trang không có form/popup/checkbox thu thập nào.
- Món hết hàng (`is_out_of_stock`) hiện mờ (`opacity: var(--opacity-out-of-stock)`) toàn card **trừ** chip "Hết hàng" luôn đọc rõ, nút `+` bị khoá (`disabled` + `aria-disabled`) — **card không bị ẩn khỏi lưới** (M2.D-31).
- Tìm kiếm và đổi tab nhóm hàng đều lọc trên mảng đã tải (D-03): 2 lần gọi `useApi` duy nhất (`/api/public/store`, `/api/public/menu`), không gọi lại BE khi gõ hoặc đổi tab, không debounce.
- Đồng bộ giỏ hàng với menu mới đúng 1 lần mỗi khi dữ liệu menu đổi (`applyMenuSync`, D-07) — báo "Giá một vài món đã được cập nhật" khi giá đổi, không im lặng.
- Banner trạng thái quán (OFF thủ công / ngoài giờ mở cửa / lỗi tải menu) dùng chung 1 `BannerNotice`, nút `+` vẫn bấm được khi banner hiện (D-20).
- Món không ảnh có placeholder nền gỗ có chủ ý (icon bát SVG tự vẽ + tên món), không phải khung trống hay ảnh lỗi (D-10).
- Lưới `repeat(auto-fill, minmax(280px, 1fr))` không dùng media query — 1 cột ở ~360px, 2 cột ~768px, 4 cột ~1200px (CONFLICT-DESIGN-01/OD-05).
- Skeleton 6 card khi tải lần đầu, tôn trọng `prefers-reduced-motion`.

## Task Commits

1. **Task 1: ImagePlaceholder + CardItem (D-10, D-11, món hết hàng)** - `8df7b02` (feat)
2. **Task 2: CategoryRail (sticky, cuộn ngang, dot pagination) + BannerNotice dùng chung** - `cb6342e` (feat)
3. **Task 3: MenuPage hoàn chỉnh — tải 1 lần, lọc client-side, đồng bộ giỏ, banner trạng thái** - `1603afd` (feat)

_Mỗi task 1 commit — không cần fix bổ sung nào sau khi verify (chỉ 2 lần chỉnh docblock trước khi commit để khớp đúng số lần literal string trong acceptance criteria, xem "Issues Encountered")._

## Files Created/Modified

- `apps/shop/src/components/ImagePlaceholder.tsx` — khối placeholder 4:3 nền `--wood-100`, icon bát SVG, tên món (D-10)
- `apps/shop/src/components/CardItem.tsx` — card món: ảnh 4:3 cover lazy-load, giá + nút `+` cùng hàng, dim + chip khi hết hàng, không giá gạch ngang/combo/coupon, comment dẫn quyết định "Bán chạy" hoãn phase sau
- `apps/shop/src/components/CategoryRail.tsx` — dải danh mục sticky (top tính bằng token, không đo JS), tile màu `var(--cat-N)` theo `(index % 7) + 1`, dot pagination ẩn ở ≥768px
- `apps/shop/src/components/BannerNotice.tsx` — 1 component 3 tone (`brand`/`warn`/`danger`) cho 4 tình huống banner, `role="alert"`/`role="status"` theo tone, nút gọi 1 chạm từ số điện thoại thô
- `apps/shop/src/pages/MenuPage.tsx` — thay ruột hoàn toàn: tải dữ liệu, lọc client-side, đồng bộ giỏ, banner, skeleton, empty state tìm kiếm/menu rỗng

## Decisions Made

- **Không thêm heading cho lưới món khi đang chọn 1 nhóm cụ thể** (chỉ hiện heading khi "Tất cả" đang active và hiện nhiều nhóm) — tránh lặp lại tên nhóm đã được tô đậm ở CategoryRail ngay phía trên.
- **CategoryRail sticky `top` tính hoàn toàn từ token** (`calc(var(--safe-top) + var(--sp-3) * 2 + var(--tap-min))`) thay vì đo chiều cao `<Header/>` thật bằng `ResizeObserver`/JS — cả 2 biến thể Header (desktop/mobile) đều có cùng công thức padding + `tap-min` nên xấp xỉ đúng mà không cần thêm state đo lường.
- **`BannerNotice.action.href` nhận số điện thoại thô**, không phải URL `tel:` đầy đủ — component tự dựng liên kết, để mọi nơi gọi `BannerNotice` không phải tự nhớ tiền tố.
- **Không dùng `dangerouslySetInnerHTML`** ở bất kỳ đâu — `off_reason` (admin nhập) và `q` (khách nhập) đều đi qua JSX text node bình thường, React tự escape (T-08-43).

## Deviations from Plan

None về mặt hành vi/kiến trúc — plan thực thi đúng như viết. Có 2 lần chỉnh nhỏ ngay trong lúc viết code (không phải deviation sau khi phát hiện lỗi, mà là tự sửa trước khi commit để khớp đúng con số acceptance criteria):

- Docblock của `BannerNotice.tsx` ban đầu nhắc chữ `tel:` trong comment giải thích, khiến `grep -c "tel:"` = 2 thay vì 1 theo acceptance criteria — đổi câu chữ để không lặp token, giữ nguyên hành vi.
- Docblock của `MenuPage.tsx` ban đầu nhắc cả 2 đường dẫn `/api/public/store` và `/api/public/menu` trong 1 câu, khiến mỗi grep đếm 2 lần thay vì 1 — viết lại câu mô tả không lặp literal path.

Không có auto-fix theo Rule 1-4 (không phát hiện bug, thiếu chức năng bắt buộc, blocker, hay cần đổi kiến trúc trong quá trình thực thi).

## Issues Encountered

- Dev server tại `http://localhost:5175/` chạy từ **checkout chính** (`/Users/m1macbook/Desktop/OrderQuanBaLun/apps/shop`), không phải từ worktree này — xác nhận bằng `curl http://localhost:5175/src/pages/MenuPage.tsx` vẫn trả về nội dung `MenuPage.tsx` CŨ (khung `08-04`, chưa có ruột mới). Đây là cách ly worktree hoạt động đúng như thiết kế, không phải lỗi. Đã xác minh bundle bằng cách build trong worktree rồi tự chạy `vite preview` tạm thời trên cổng `5199` (đã dọn dẹp ngay sau khi kiểm), `curl` bundle JS xác nhận có đủ chuỗi copy quan trọng (`Không tải được menu`, `Hết hàng`, `Không tìm thấy món nào`). Khi orchestrator merge nhánh này vào `main`, dev server ở `5175` sẽ tự nhận thay đổi qua HMR/reload như bình thường — không cần thao tác gì thêm.
- `apps/shop/src/BrandPreview.tsx` (file có sẵn từ phase 7, KHÔNG thuộc `files_modified` của plan này) vẫn còn 1 hex `#ffffff` — phát hiện khi chạy `grep -rn "#[0-9a-fA-F]\{3,6\}" apps/shop/src --include='*.tsx'` cho toàn bộ verification section của plan (câu lệnh quét cả thư mục, không chỉ file của plan này). File này không được import ở bất kỳ đâu (`main.tsx` đã bỏ import theo đúng quyết định của phase 7/8), nên không vào bundle và không ảnh hưởng `check-shop-bundle.sh`. Đây là nợ kỹ thuật có sẵn, ngoài phạm vi `files_modified` của plan 08-09 (Scope Boundary) — không sửa, chỉ ghi nhận ở đây để phase sau biết nếu cần dọn `BrandPreview.tsx`.

## Known Stubs

- Badge "Bán chạy" chưa thi công (đúng chủ đích, đã ghi comment trong `CardItem.tsx`): `/api/public/menu` chỉ trả 7 field theo M2.D-43, không có trường thống kê bán hàng nào để suy ra "bán chạy" — cần phase sau bổ sung endpoint/])trường dữ liệu bán thật trước khi chèn badge.
- `/api/public/store` lỗi mạng (khác `/api/public/menu` lỗi) hiện chưa có banner riêng — nếu BE chết hoàn toàn thì `menu.error` cũng kích hoạt cùng lúc nên banner "Không tải được menu" vẫn hiện (2 endpoint cùng phụ thuộc 1 backend), nhưng trường hợp lý thuyết "chỉ `/store` chết, `/menu` sống" sẽ khiến trang không hiện banner OFF nào (fail-open, không chặn khách xem menu) — chấp nhận được vì đây không phải lỗi bảo mật, chỉ là banner thông tin.

## User Setup Required

None - không cần cấu hình dịch vụ ngoài nào.

## Next Phase Readiness

- `MenuPage.tsx` đã sẵn sàng cho plan 08-10 (checkout công khai) dùng chung `useCart()`/`cart-store.ts` — không cần sửa gì thêm ở lớp giỏ hàng.
- `BannerNotice.tsx` và `CategoryRail.tsx` là component dùng chung, có thể tái sử dụng ở `/cart` và `/checkout` (banner lỗi submit 409/rate-limit dùng tone `danger` đã có sẵn).
- Chưa có blocker. Điểm cần lưu ý cho phase 9 (order tracking): `off_reason`/tên món render trực tiếp qua JSX text (không `dangerouslySetInnerHTML`) — giữ nguyên convention này khi làm `/o/:token` đầy đủ.

---
*Phase: 08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n*
*Completed: 2026-07-30*

## Self-Check: PASSED

- Tất cả 5 file (4 mới + 1 sửa) tồn tại trên đĩa, đã kiểm bằng `ls -la`.
- Cả 3 commit task (`8df7b02`, `cb6342e`, `1603afd`) tồn tại trong `git log --oneline --all`.
- `typecheck` / `test` / `build` sạch; `sh scripts/check-shop-bundle.sh` trả `OK` cả 2 gate (316 kB < ngưỡng 320 kB).
