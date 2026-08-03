---
phase: 9
slug: duy-t-n-th-ng-b-o-theo-d-i-n
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-31
updated: 2026-08-03
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

*Điền đầy đủ 2026-08-03 tại plan 09-13. `Threat Ref` là mã thật trong `<threat_model>` của plan đã
KHAI báo threat đó — có thể khác plan viết test (vd T-09-26 khai ở 09-06, test integration nằm ở
09-08). `Status` là kết quả chạy thật, không phải sao lại từ SUMMARY.*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 09-08 Task 1 | 09-08 | 5 | REQ-M | T-09-26 | 2 admin duyệt song song không cấp trùng bàn (row lock giữ) | integration (2 MySQL connection thật) | `./node_modules/.bin/vitest run src/modules/admin-online-orders/admin-online-orders.integration.test.ts` | ✅ có | ✅ green |
| 09-08 Task 2 | 09-08 | 5 | REQ-M | T-09-28 | Đơn `WAITING` không lọt vào doanh thu / bếp / sơ đồ bàn / history | integration (đếm doanh thu trước và sau khi có 5 đơn WAITING) | cùng file trên, `describe` riêng | ✅ có | ✅ green |
| 09-07 Task 1 + 09-08 Task 2 | 09-07, 09-08 | 4, 5 | REQ-M | T-09-36, T-09-32 | Cả 3 role duyệt được (D-02) **và** audit log ghi đúng actor đã duyệt — kiểm soát bù trừ của OD-16 | unit (guard) + integration (audit row) | `./node_modules/.bin/vitest run src/modules/admin-online-orders/` | ✅ có | ✅ green |
| 09-09 Task 1 | 09-09 | 5 | REQ-M | T-09-46 | Ghi chú nội bộ khi từ chối (D-09) KHÔNG xuất hiện trong response công khai | unit (assert shape) | `./node_modules/.bin/vitest run src/modules/public/public-orders.test.ts` | ✅ có | ✅ green |
| 09-05 Task 2 | 09-05 | 2 | REQ-N | T-09-22 | Poller outbox quét đúng `scheduled_at <= now AND status = PENDING` | unit (hàm thuần chọn hàng) + integration (bảng thật) | `./node_modules/.bin/vitest run src/modules/notifications/` | ✅ có | ✅ green |
| 09-05 Task 1 | 09-05 | 2 | REQ-N | T-09-20 | Đổi `SMS_DRIVER` console↔esms không sửa logic gọi | unit (contract test chung cho 2 implementation của `SmsChannel`) | `./node_modules/.bin/vitest run src/modules/notifications/channels/sms-channel.test.ts` | ✅ có | ✅ green |
| 09-06 Task 2 + 09-09 Task 2 | 09-06, 09-09 | 3, 5 | REQ-N | T-09-23 | Duyệt trước ngưỡng 90s thì outbox SMS bị huỷ, không gửi | integration (`cancelPendingForRequest` trong cùng transaction duyệt) | `./node_modules/.bin/vitest run src/modules/notifications/` | ✅ có | ✅ green |
| 09-01 Task 2 | 09-01 | 1 | REQ-O | T-09-02 | `computeProgress()` đúng công thức §6, **đơn điệu** (không bao giờ tụt), chặn 95% khi chưa xong | unit (hàm thuần) | `./node_modules/.bin/vitest run src/modules/public/order-progress.test.ts` | ✅ có | ✅ green |
| 09-09 Task 1 | 09-09 | 5 | REQ-O | T-09-45 | Response `/api/public/orders/:token` **tuyệt đối không** chứa `status` từng item (M2.D-23, điều kiện của G-1) | unit (`.strict().parse()` + assert khoá) + `curl \| grep -c '"state"'` = 0 chạy thật ở 09-11 | `./node_modules/.bin/vitest run src/modules/public/public-orders.test.ts` | ✅ có | ✅ green |
| 09-12 Task 2 | 09-12 | 7 | REQ-M/N/O | T-09-65 | Bỏ chặn 409 theo D-11 mà 4 lớp chống lạm dụng vẫn xanh (D-18) | unit (order-guard viết lại, 12 test gồm case quét 16 tổ hợp cờ) + **4 kịch bản HTTP thật** | `./node_modules/.bin/vitest run src/modules/public/order-guard.test.ts` | ✅ có | ✅ green |
| 09-11 Task 2 | 09-11 | 6 | REQ-O | T-09-63 | Bundle `apps/shop` không rò code trang quản lý sang khách | script gate (11 chuỗi cấm) | `bash scripts/check-shop-bundle.sh` | ✅ có | ⚠️ đổi phạm vi — gate **kích thước** đã bỏ hẳn (OD-12, chỉ còn in số); gate **bảo mật** vẫn chặn và vẫn xanh |
| 09-12 Task 1 | 09-12 | 7 | REQ-M | T-09-68 | 2 key câu chữ round-trip đủ 3 chỗ, không bị `updateMany` nuốt lặng lẽ, chuỗi dài không bị cắt | manual HTTP + DB (ghi 500 ký tự rồi đọc lại) | `curl -s http://localhost:3001/api/public/store` sau khi ghi `store_settings` | ✅ có | ⚠️ một phần — đã chứng minh DB→`readAll()`→API giữ đủ 500 ký tự; lượt `PUT /admin/settings` qua `AdminGuard` **chưa chạy** (cần mật khẩu admin), xem `09-UAT.md` hạng mục 6 |
| 09-08 Task 3 | 09-08 | 5 | REQ-M | T-09-43 | `ship_fee` tách khỏi doanh thu **món** (M2.D-62) | integration (đếm doanh thu có/không ship_fee) | `./node_modules/.bin/vitest run src/modules/admin-online-orders/` | ✅ có | ✅ green |
| 09-02 Task 2 | 09-02 | 1 | REQ-N | T-09-06 | 2 cron đang chết được hồi sinh và thực sự chạy (C-CRON-01) | unit (`ScheduleModule` đăng ký) + log boot | `./node_modules/.bin/vitest run` (full suite) | ✅ có | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `apps/api/src/modules/admin-online-orders/admin-online-orders.integration.test.ts` — REQ-M
      (row lock cấp bàn + doanh thu không nhiễm đơn WAITING). Dựng theo khuôn
      `apps/api/src/modules/public/open-order-lock.integration.test.ts` đã chạy 2 connection MySQL
      thật ở phase 8.
- [x] `apps/api/src/modules/notifications/*.test.ts` — REQ-N (poller outbox + contract test cho 2
      implementation `SmsChannel`)
- [x] `apps/api/src/modules/public/order-progress.test.ts` — REQ-O (công thức %, đơn điệu, chặn 95%)
- [x] Cài `@nestjs/schedule@6.1.3` vào `apps/api` — **`pnpm` hỏng, phải cài bằng cách khác** và ghi
      rõ cách đã dùng vào SUMMARY
- [x] Mở rộng `apps/api/src/modules/public/public-orders.test.ts` (file phase 8, KHÔNG tạo mới)
- [x] Viết lại `apps/api/src/modules/public/order-guard.test.ts` — test hiện tại khẳng định hành vi
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

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags (`vitest run`, không phải `vitest`)
- [x] Feedback latency < 25s
- [x] Bảng Per-Task Verification Map đã điền Task ID thật — không còn ô nào để trống chờ điền
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved — 2026-08-03, chủ dự án.

Checkpoint `09-13-PLAN.md` Task 4 (14 bước) được chủ dự án duyệt, **không báo bước nào sai**.

Phạm vi của approval này — đọc kỹ trước khi dùng làm bằng chứng:

- ✅ Áp cho **luồng chạy ở local**: hàng chờ duyệt + chuông + SSE, duyệt/từ chối đơn, cấp bàn, trang
  `/o/:token`, khách tự huỷ đơn, và công tắc 2 trạng thái đều nhận đơn (D-11).
- ❌ **KHÔNG** áp cho 6 hạng mục trong `09-UAT.md` — tất cả vẫn `result: pending`. Trong đó hạng mục 5
  (`docker build` + `sharp` trên alpine) là **gate cứng trước deploy production**, kế thừa từ
  `08-UAT.md` test 1 và chưa từng chạy trong cả 3 phase 7/8/9.
- ⚠ Người thi công **không chạy** được 11 hạng mục nghiệm thu trình duyệt của 09-10/09-11/09-12 (không
  có công cụ điều khiển trình duyệt) và **không có mật khẩu admin**. Approval này là lần đầu những
  hạng mục đó được người thật kiểm — nếu sau này phát hiện lệch, đối chiếu lại § Manual-Only ở trên.
