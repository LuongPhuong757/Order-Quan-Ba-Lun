---
phase: 9
slug: duy-t-n-th-ng-b-o-theo-d-i-n
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-31
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Nguồn: `09-RESEARCH.md` § Validation Architecture. Bảng "Per-Task Verification Map" bên dưới
> điền task ID thật **sau khi planner sinh xong PLAN.md** (giống cách phase 8 làm ở plan 08-13).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^2.1.0 — đã cấu hình ở `apps/api`, không có `vitest.config.ts`, chạy trên default Node environment |
| **Config file** | none — mặc định Vitest |
| **Quick run command** | `cd apps/api && ./node_modules/.bin/vitest run <file>` |
| **Full suite command** | `cd apps/api && ./node_modules/.bin/vitest run` |
| **Estimated runtime** | ~15–25 giây (106 test hiện có; integration test MySQL chiếm phần lớn) |

⚠ **`pnpm` HỎNG trên máy này** (Node 20 vs `node:sqlite` → `ERR_UNKNOWN_BUILTIN_MODULE`). Mọi lệnh
phải gọi binary trực tiếp: `./node_modules/.bin/vitest`, `../../node_modules/.bin/tsc --noEmit`.
Acceptance criteria nào viết `pnpm --filter ...` thì chạy tương đương và ghi rõ việc thay thế.

⚠ **Full suite cần MySQL sống** (port 3307, `order_quan_balun`). Integration test của phase này
không mock được — xem C-TEST-01.

---

## Sampling Rate

- **After every task commit:** Chạy riêng file test vừa sửa — `./node_modules/.bin/vitest run <file>`
- **After every plan wave:** `cd apps/api && ./node_modules/.bin/vitest run` (toàn bộ, gồm integration)
- **Before `/gsd:verify-work`:** Full suite xanh **và** `bash scripts/check-shop-bundle.sh` OK
- **Max feedback latency:** ~25 giây

---

## Per-Task Verification Map

*Task ID điền sau khi planner sinh PLAN.md. Bảng hiện ghi theo requirement để planner biết mỗi
requirement phải gắn vào test nào.*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | REQ-M | TBD | 2 admin duyệt song song không cấp trùng bàn (row lock giữ) | integration (2 MySQL connection thật) | `./node_modules/.bin/vitest run src/modules/admin-online-orders/admin-online-orders.integration.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | REQ-M | TBD | Đơn `WAITING` không lọt vào doanh thu / bếp / sơ đồ bàn / history | integration (đếm doanh thu trước và sau khi có 5 đơn WAITING) | cùng file trên, `describe` riêng | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | REQ-M | TBD | Cả 3 role duyệt được (D-02) **và** audit log ghi đúng actor đã duyệt | unit (guard) + integration (audit row) | `./node_modules/.bin/vitest run src/modules/admin-online-orders/` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | REQ-M | TBD | Ghi chú nội bộ khi từ chối (D-09) KHÔNG xuất hiện trong response công khai | unit (assert shape) | `./node_modules/.bin/vitest run src/modules/public/public-orders.test.ts` | ⚠ mở rộng file có sẵn | ⬜ pending |
| TBD | TBD | TBD | REQ-N | TBD | Poller outbox quét đúng `scheduled_at <= now AND status = PENDING` | unit (hàm thuần chọn hàng) + integration (bảng thật) | `./node_modules/.bin/vitest run src/modules/notifications/` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | REQ-N | TBD | Đổi `SMS_DRIVER` console↔esms không sửa logic gọi | unit (contract test chung cho 2 implementation của `SmsChannel`) | `./node_modules/.bin/vitest run src/modules/notifications/channels/` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | REQ-N | TBD | Duyệt trước ngưỡng 90s thì outbox SMS bị huỷ, không gửi | unit hoặc integration | `./node_modules/.bin/vitest run src/modules/notifications/` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | REQ-O | TBD | `computeProgress()` đúng công thức §6, **đơn điệu** (không bao giờ tụt), chặn 95% khi chưa xong | unit (hàm thuần) | `./node_modules/.bin/vitest run src/modules/public/order-progress.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | REQ-O | TBD | Response `/api/public/orders/:token` **tuyệt đối không** chứa `status` từng item (M2.D-23, điều kiện của G-1) | unit (assert `Object.keys` không có field cấm — theo mẫu `public-menu-shape.test.ts`) | `./node_modules/.bin/vitest run src/modules/public/public-orders.test.ts` | ⚠ mở rộng file có sẵn | ⬜ pending |
| TBD | TBD | TBD | REQ-M/N/O | TBD | Bỏ chặn 409 theo D-11 mà 4 lớp chống lạm dụng vẫn xanh (D-18) | unit (order-guard viết lại) | `./node_modules/.bin/vitest run src/modules/public/order-guard.test.ts` | ⚠ file có sẵn, sẽ vỡ và phải viết lại | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/api/src/modules/admin-online-orders/admin-online-orders.integration.test.ts` — REQ-M
      (row lock cấp bàn + doanh thu không nhiễm đơn WAITING). Dựng theo khuôn
      `apps/api/src/modules/public/open-order-lock.integration.test.ts` đã chạy 2 connection MySQL
      thật ở phase 8.
- [ ] `apps/api/src/modules/notifications/*.test.ts` — REQ-N (poller outbox + contract test cho 2
      implementation `SmsChannel`)
- [ ] `apps/api/src/modules/public/order-progress.test.ts` — REQ-O (công thức %, đơn điệu, chặn 95%)
- [ ] Cài `@nestjs/schedule@6.1.3` vào `apps/api` — **`pnpm` hỏng, phải cài bằng cách khác** và ghi
      rõ cách đã dùng vào SUMMARY
- [ ] Mở rộng `apps/api/src/modules/public/public-orders.test.ts` (file phase 8, KHÔNG tạo mới)
- [ ] Viết lại `apps/api/src/modules/public/order-guard.test.ts` — test hiện tại khẳng định hành vi
      chặn 409 mà D-11 vừa bỏ, nên **nó SẼ đỏ**; đây là dự kiến, không phải hồi quy

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Chuông thật kêu được sau khi bấm "Bật chuông", và lặp đúng 5 phút | REQ-N (D-03/D-04) | Autoplay policy của trình duyệt và phát âm thanh không mô phỏng được trong Vitest/jsdom | Mở `/admin/online-orders` trên Chrome thật, KHÔNG bấm gì → xác nhận banner đỏ "Chuông đang tắt" hiện. Bấm 1 lần → tạo 1 đơn từ trang khách → nghe chuông. Chờ 5 phút không duyệt → nghe lại. Duyệt xong → im. |
| Độ trễ SSE < 2s từ lúc khách submit tới lúc đơn hiện trên màn admin | REQ-N (ROADMAP criterion 1) | Cần 2 trình duyệt thật + đồng hồ; test tự động chỉ chứng minh event được phát, không chứng minh độ trễ đầu-cuối | Mở `/admin/online-orders` một bên, trang khách một bên, submit đơn, bấm giờ tới lúc dòng đơn xuất hiện |
| Chấm trạng thái chuyển đỏ + banner khi SSE đứt (D-07) | REQ-N | Cần ngắt mạng thật / kill API giữa chừng | Mở trang hàng chờ → `kill` tiến trình API → sau ~10s xác nhận chấm đỏ + banner. Bật lại API → xác nhận tự nối lại **và tải lại toàn bộ hàng chờ** (D-06) |
| 2 câu chữ Đóng cửa hiển thị đúng và không bị cắt khi chủ quán nhập chuỗi dài | REQ-M (D-11/D-14) | Độ dài do người nhập, không cố định | Nhập 1 đoạn ~300 ký tự vào `closed_banner_text` ở `/admin/settings` → mở trang khách trên viewport 375px → xác nhận xuống dòng đủ, không ellipsis, không tràn ngang |
| Nhân viên không nhầm ô "lý do gửi khách" với ô "ghi chú nội bộ" (D-08/D-09) | REQ-M | Là rủi ro về nhận thức người dùng, không phải logic | Cho 1 người chưa từng dùng màn này từ chối 1 đơn, hỏi lại họ nghĩ khách nhìn thấy gì |
| Docker build + `sharp` trên alpine | — | Kế thừa từ `08-UAT.md` test 1 | **GATE BẮT BUỘC trước deploy production**, không phải blocker của phase 9 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags (`vitest run`, không phải `vitest`)
- [ ] Feedback latency < 25s
- [ ] Bảng Per-Task Verification Map đã điền task ID thật (không còn `TBD`)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
