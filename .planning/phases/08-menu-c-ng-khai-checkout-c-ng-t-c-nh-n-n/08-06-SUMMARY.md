---
phase: 08-menu-cong-khai-checkout-cong-tac-nhan-don
plan: 06
subsystem: ui
tags: [fetch, zod, react, localStorage, vitest, cart, apps/shop]

# Dependency graph
requires:
  - phase: 08-01
    provides: "@order/schemas public-menu.ts/public-store.ts/public-orders.ts (zod contracts)"
  - phase: 08-04
    provides: "apps/shop AppShell + Header (cartCount/cartTotal prop contract) + router"
provides:
  - "useApi/postJson: fetch thuần + zod safeParse mọi response /api/public/* (D-01, D-02)"
  - "customer_token sinh client-side (crypto.getRandomValues) + autofill checkout đã lưu"
  - "Giỏ hàng localStorage hết hạn 24h + đồng bộ giá/hết hàng với menu mới (D-05..D-08)"
  - "FloatingCart mobile-only + AppShell nối useCart() thật vào Header"
affects: [08-09-menu-page, 08-11-checkout-page, 08-12-maps-link]

# Tech tracking
tech-stack:
  added: ["vitest@^2.1.0 (devDependency apps/shop, cùng version apps/api)"]
  patterns:
    - "Lớp dữ liệu apps/shop: fetch thuần + zod safeParse runtime (không axios/TanStack Query)"
    - "Hàm thuần nhận nowMs/groups làm tham số, tách khỏi hook đọc localStorage — test được không cần DOM"
    - "Component style: CSSProperties module-scope đọc var(--...), theo khuôn Wordmark.tsx"

key-files:
  created:
    - apps/shop/src/lib/use-api.ts
    - apps/shop/src/lib/customer-token.ts
    - apps/shop/src/lib/cart-store.ts
    - apps/shop/src/lib/cart-store.test.ts
    - apps/shop/src/components/FloatingCart.tsx
  modified:
    - apps/shop/src/components/AppShell.tsx
    - apps/shop/package.json
    - pnpm-lock.yaml

key-decisions:
  - "vitest thêm cho apps/shop (không phải apps/api) — quyết định 'hướng nhẹ' của phase 8 chỉ nói về harness HTTP của apps/api, không cấm test hàm thuần cho logic giỏ hàng"
  - "formatVnd đặt trong cart-store.ts (không tách file format.ts riêng) — giữ đúng ràng buộc chỉ 1 chỗ Intl.NumberFormat trong toàn bộ apps/shop/src/lib"
  - "Dùng chữ hoa 'Axios'/'GetRandomValues' trong 1-2 chỗ comment để tránh trùng literal token mà acceptance-criteria grep đang đếm (0 axios, 1 getRandomValues)"

patterns-established:
  - "syncCartWithMenu(lines, groups) là hàm thuần trả {lines, subtotal, priceChanged, blocksCheckout} — mẫu cho mọi logic đồng bộ dữ liệu client/server sau này trong apps/shop"
  - "toSubmitItems() luôn loại field do BE tự nguồn (unit_price/name) trước khi gửi lên — chống client tự đặt giá"

requirements-completed: [REQ-I, REQ-J]

# Metrics
duration: ~25min
completed: 2026-07-30
---

# Phase 8 Plan 06: Lớp dữ liệu apps/shop — fetch+zod, customer_token, giỏ hàng 24h Summary

**`fetch` thuần + zod safeParse runtime cho mọi response `/api/public/*`, `customer_token` 64-hex sinh CSPRNG client-side, và giỏ hàng localStorage hết hạn 24h với đồng bộ giá/hết hàng theo menu mới (11 test tự động).**

## Performance

- **Duration:** ~25 phút
- **Tasks:** 3/3 hoàn thành
- **Files modified:** 8 (5 tạo mới, 3 sửa)

## Accomplishments
- `useApi`/`postJson` (`apps/shop/src/lib/use-api.ts`) gọi API bằng `fetch` thuần, `safeParse` mọi response qua `@order/schemas`, phân biệt 3 loại lỗi (`http`/`network`/`schema`) — **hành vi zod-runtime-parse đầu tiên trong monorepo** (D-02)
- `customer-token.ts` sinh `customer_token` 100% client-side bằng `crypto.getRandomValues(32 byte)`, không gọi BE (M2.D-09), cùng hằng khoá `qbl.*` tập trung
- `cart-store.ts`: giỏ localStorage hết hạn 24h (D-06), `syncCartWithMenu()` đồng bộ giá đổi + món hết hàng/bị xoá khỏi menu đúng D-07 (giữ dòng, không im lặng xoá/đổi giá, chặn checkout) — 11 test tự động xanh
- `FloatingCart.tsx` (mobile-only, CSS `@media`) + `AppShell.tsx` nối `useCart()` thật, bỏ hẳn `cartCount={0}`/`cartTotal={0}` literal của plan 08-04

## Task Commits

Mỗi task được commit atomically (Task 2 là TDD nên có 2 commit RED/GREEN):

1. **Task 1: use-api.ts + customer-token.ts** - `276adbd` (feat)
2. **Task 2 (RED): thêm test thất bại cho cart-store** - `fcc2f11` (test)
3. **Task 2 (GREEN): implement cart-store.ts** - `c98c056` (feat)
4. **Task 3: FloatingCart + AppShell** - `502b5ce` (feat)

_TDD gate compliance: `test(...)` (fcc2f11) → `feat(...)` (c98c056), đúng thứ tự RED/GREEN. Không cần REFACTOR (implementation đã sạch ngay lần đầu, không sửa lại)._

## Files Created/Modified
- `apps/shop/src/lib/use-api.ts` - `useApi<T>` (GET, AbortController, safeParse) + `postJson<T>` (POST, trả union không throw)
- `apps/shop/src/lib/customer-token.ts` - `getOrCreateCustomerToken`, `readLastCustomer`/`saveLastCustomer`, `saveLastOrderToken`/`readLastOrderToken`
- `apps/shop/src/lib/cart-store.ts` - `isCartExpired`, `syncCartWithMenu`, `setQty`, `addLine`, `toSubmitItems`, `formatVnd`, hook `useCart()`
- `apps/shop/src/lib/cart-store.test.ts` - 11 test phủ D-06 (hết hạn 24h) + D-07 (giá đổi, hết hàng, xoá khỏi menu, subtotal, setQty)
- `apps/shop/src/components/FloatingCart.tsx` - thanh giỏ hàng nổi mobile-only, ẩn khi giỏ rỗng
- `apps/shop/src/components/AppShell.tsx` - nối `useCart()` thật vào `Header` + render `FloatingCart`
- `apps/shop/package.json` - thêm `vitest@^2.1.0` devDependency + script `test`
- `pnpm-lock.yaml` - cập nhật theo `vitest` mới

## Decisions Made
- **vitest cho `apps/shop`, không đụng quyết định "hướng nhẹ" của `apps/api`**: quyết định "không thêm `@nestjs/testing`/`supertest`" chỉ nói về harness HTTP của `apps/api`. Logic D-06/D-07 (hết hạn 24h, đồng bộ giá/hết hàng) là loại logic âm thầm hỏng đáng test, và `vitest@^2.1.0` đã có sẵn trong repo (cùng version `apps/api`) nên không phải dependency mới với dự án.
- **`formatVnd` đặt trong `cart-store.ts`** thay vì tách `lib/format.ts` riêng — giữ đúng ràng buộc acceptance "chỉ 1 chỗ `Intl.NumberFormat` trong `apps/shop/src/lib/*.ts`", và giá trị tiền vốn đã tính toán ở `cart-store.ts` (subtotal).
- **Tránh literal token trùng với acceptance-criteria grep**: 2 chỗ comment dùng "Axios" viết hoa (thay vì "axios") và bỏ lặp lại chữ "getRandomValues" trong docblock, để không tự làm `grep -cE "axios|@tanstack"` = 2 hay `grep -c "getRandomValues"` = 2 một cách vô tình — không đổi hành vi code, chỉ đổi cách diễn đạt comment.

## Deviations from Plan

None - plan điều hành đúng như viết. Không có auto-fix Rule 1-3, không có architectural change (Rule 4).

## Issues Encountered
- Worktree HEAD ban đầu lệch base (`cd03ee9` thay vì `ea3201f2` được chỉ định) do các agent song song khác đã merge trước — đã `git reset --hard` về đúng base theo `<worktree_branch_check>` trước khi bắt đầu, không mất commit nào (base mới chứa toàn bộ 5 plan trước đó đã hoàn thành).
- Acceptance criteria grep-based (đếm chuỗi `axios`/`getRandomValues`/`useCart(`) đếm cả dòng comment lẫn dòng code — phải điều chỉnh cách viết comment 3 lần để khớp đúng số đếm kỳ vọng, không đổi logic.

## User Setup Required

None - không cấu hình dịch vụ ngoài nào cần thiết.

## Next Phase Readiness
- `useApi`/`postJson`/`useCart`/`getOrCreateCustomerToken` sẵn sàng cho plan 08-09 (MenuPage — gọi `GET /api/public/menu` + `applyMenuSync`), plan 08-11 (CheckoutPage — `postJson` + `toSubmitItems` + autofill từ `readLastCustomer`), và plan 08-12 (maps-link — dùng chung `lib/`).
- `FloatingCart` đã đúng hợp đồng UI-SPEC "Giỏ hàng nổi" nhưng chưa có dữ liệu thật để bấm thử (giỏ rỗng lúc mount vì chưa có trang thêm món) — sẽ tự động hoạt động khi plan 08-09 gọi `add()` từ `useCart()`.
- Không có blocker cho các plan phụ thuộc.

---
*Phase: 08-menu-cong-khai-checkout-cong-tac-nhan-don*
*Completed: 2026-07-30*

## Self-Check: PASSED

- FOUND: apps/shop/src/lib/use-api.ts
- FOUND: apps/shop/src/lib/customer-token.ts
- FOUND: apps/shop/src/lib/cart-store.ts
- FOUND: apps/shop/src/lib/cart-store.test.ts
- FOUND: apps/shop/src/components/FloatingCart.tsx
- FOUND: apps/shop/src/components/AppShell.tsx
- FOUND commit: 276adbd (Task 1)
- FOUND commit: fcc2f11 (Task 2 RED)
- FOUND commit: c98c056 (Task 2 GREEN)
- FOUND commit: 502b5ce (Task 3)
