---
phase: 09-duy-t-n-th-ng-b-o-theo-d-i-n
plan: 13
wave: 8
status: complete
completed_at: 2026-08-03
requirements-completed: [REQ-M, REQ-N, REQ-O]
files_modified:
  - OVERRIDE-DEBT.md
  - .planning/ROADMAP.md
  - .planning/REQUIREMENTS.md
  - .planning/phases/08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n/08-VERIFICATION.md
  - .planning/phases/09-duy-t-n-th-ng-b-o-theo-d-i-n/09-VALIDATION.md
  - .planning/phases/09-duy-t-n-th-ng-b-o-theo-d-i-n/09-UAT.md
  - apps/api/src/modules/public/order-guard.ts
  - apps/api/src/modules/public/store-status.ts
  - apps/api/src/modules/settings/settings.defaults.ts
verification: >
  18 entry OD (6 mới, mỗi entry đủ 6 nhãn) · 0 dòng TBD trong 09-VALIDATION · 15 mã T-09-NN đã đối chiếu
  tồn tại thật · 3 tsc sạch · 245+29+35 test xanh · bundle gate OK · checkpoint 14 bước approved 2026-08-03
---

# 09-13 — Đóng phase 9: ghi vết override, sửa tài liệu nói ngược code

Plan docs-only + 1 checkpoint chặn. Không sửa một dòng logic nào; 3 file code chỉ thêm số hiệu OD vào
docblock.

## Đã làm

### Task 1 — `OVERRIDE-DEBT.md`: 6 entry mới

| Entry | Ghi đè | Nội dung |
|---|---|---|
**OD-13** | M2.D-26 + M2.D-27 | Công tắc "Đóng cửa" không còn chặn đơn — cả 2 trạng thái đều nhận đơn, chỉ đổi chữ |
**OD-14** | pseudo-code spec §7:480 | Không dùng `getOrCreateOpenOrder()` khi duyệt — nó tự mở transaction riêng |
**OD-15** | M2.D-60 + phần auto-OFF của M2.D-36 | Bỏ hẳn auto-OFF, không còn cơ chế tự đổi công tắc |
**OD-16** | M2.D-33 + phần phân quyền M2.D-32 | Cả 3 role duyệt được, audit log là kiểm soát bù trừ |
**OD-17** | `09-RESEARCH.md` Pattern 4 | Chuông dùng Web Audio API thay `HTMLAudioElement` |
**OD-18** | — (hoãn, không ghi đè) | Hoãn nửa `PATCH` của M2.D-44; **nêu rõ nửa huỷ ĐÃ làm ở 09-11** |

Mỗi entry đủ 6 nhãn (`Ngày` · `Quyết định gốc` · `Lệch` · `Vì sao` · `Ghi ở` · `Quay lại thì sao`) —
kiểm bằng script, 6/6 cho cả 6 entry.

Mục "Chưa được ghi ở đây" đã cập nhật: chuỗi M2.D-60 → M2.D-36 nay chỉ còn giá trị **lịch sử**, có trỏ
tới OD-15, không để 2 chỗ nói ngược nhau.

**Đánh giá các lệch thuần kỹ thuật** (theo yêu cầu của plan): `closed_submit_confirm_text` đặt trên
`/api/public/store` thay vì theo gợi ý PATTERNS, và việc tách `runWithRetry`/`KIND_FORMAT` thành module
dùng chung — **kết luận: KHÔNG tạo entry OD**. Cả hai không ghi đè quyết định `M2.D-xx` nào đã LOCKED;
lý do đã ghi trong `09-12-SUMMARY.md` và `09-03-SUMMARY.md`. Tiêu chí phân loại: entry OD dành cho lệch
**quyết định của chủ dự án**, không dành cho lựa chọn kỹ thuật nội bộ.

### Task 2 — 3 tài liệu hết nói ngược code

**ROADMAP:**
- Phase 9 criterion 1 → *"cả 3 role đều xem và duyệt được, audit log là kiểm soát bù trừ"* (trỏ OD-16)
- Phase 9 criterion 4 → bỏ auto-OFF; thêm câu *"SMS 90s nay là lớp duy nhất còn tới được người không
  ngồi trước máy"* (trỏ OD-15)
- Phase 8 criterion 3 → **giữ nguyên câu cũ**, thêm chú thích tại chỗ rằng nó đúng lúc verify và đã bị
  phase 9 cố ý làm hết hiệu lực. **Tick `[x]` của phase 8 không đổi.**

**REQUIREMENTS:** REQ-K (bỏ "chặn 2 lớp"), REQ-M (bỏ giới hạn 1 role), REQ-N (3 lớp thay 4, bỏ
auto-OFF). Thêm mục **`## Deferred Features`** đặt **trước** `## Deferred UAT` — cố ý tách 2 mục: một
là *tính năng chưa thi công*, một là *hạng mục chưa nghiệm thu được*. REQ-M/N/O **vẫn `[ ]`**, không tự
tick (đó là việc của `/gsd-verify-work`; phase 8 đã có bài học tick sớm với REQ-J).

**08-VERIFICATION.md:** khối chú thích sau bảng Observable Truths — truth #3 nay không còn đúng, có chủ
đích; nêu rõ phần nào **vẫn còn đúng** (đơn đang chạy không bị ảnh hưởng · tự-ON 00:00 · toàn bộ truth
#4 về 4 lớp chống lạm dụng). `status: passed` **không đổi** — sửa lịch sử nghiệm thu còn tệ hơn.

### Task 3 — `09-VALIDATION.md` + `09-UAT.md`

`09-VALIDATION.md`: 10 dòng `TBD` → **14 dòng** Task ID thật (10 dòng gốc + 4 hạng mục phát sinh: gate
bundle, round-trip 2 key, `ship_fee` tách doanh thu, 2 cron hồi sinh). **15 mã `T-09-NN` đều đã đối
chiếu tồn tại thật** trong `<threat_model>` của plan tương ứng bằng `grep`, không gõ từ ký ức.

2 dòng ghi `⚠️ một phần` thay vì `✅ green` — trung thực về chỗ chưa trọn: gate bundle (kích thước đã bỏ
theo OD-12, chỉ gate bảo mật còn chặn) và round-trip 2 key (chưa đi qua `AdminGuard`).

`09-UAT.md` (mới): **6 hạng mục** `result: pending` + bảng tổng kết. Hạng mục 5 (`docker build` +
`sharp`) giữ nguyên trạng **gate cứng trước deploy production**, kế thừa từ `08-UAT.md` test 1.

### Task 4 — checkpoint: **APPROVED**

Chủ dự án duyệt 14 bước ngày 2026-08-03, **không báo bước nào sai**. Ghi vào
`09-VALIDATION.md § Approval` kèm phạm vi rõ ràng: approval áp cho **luồng local**, **không** áp cho 6
hạng mục `09-UAT.md`.

**4 việc chuẩn bị trước khi mở checkpoint** — làm được 2, thiếu 2:

| # | Việc | Kết quả |
|---|---|---|
1 | 3 dev server | ✅ 3001 / 5173 / 5174 đều trả 200 |
2 | 3 `tsc` + 3 suite test + build + bundle gate | ✅ tất cả xanh (số liệu dưới) |
3 | Tài khoản role `kitchen` | ⚠ có (`a`) nhưng **không biết mật khẩu** |
4 | `store_phone` + `notify_sms_recipients` | ❌ **cả hai TRỐNG** — đã báo cho chủ dự án trước khi mở checkpoint |

## Verify đã chạy

| Kiểm | Kết quả |
|---|---|
`apps/api` tsc · vitest | sạch · **245/245** |
`apps/web` tsc · vitest | sạch · **29/29** |
`apps/shop` tsc · vitest | sạch · **35/35** |
`vite build` + `check-shop-bundle.sh` | raw 360 kB · gzip 104 kB · gate 11 chuỗi cấm **sạch** |
`grep -c "^## OD-" OVERRIDE-DEBT.md` | **18** |
6 entry mới × 6 nhãn | **6/6** mỗi entry |
`TBD` trong 09-VALIDATION | **0** |
`T-09-` trong 09-VALIDATION | **15** |
`result: pending` trong 09-UAT | **6** |
`status: passed` trong 08-VERIFICATION | **1** (không đổi) |
REQ-M/N/O còn `[ ]` | **1/1/1** ✓ |

## Deviations from Plan

### 1. [Rule 4-nhẹ — xung đột số hiệu] 6 entry là OD-13..18, không phải OD-11..16; tổng 18 không phải 16

Plan được soạn **trước khi** plan 09-10 và 09-11 tự thêm entry — nên OD-11 (mở filter 3 trạng thái) và
OD-12 (bỏ ngưỡng bundle) **đã bị dùng**, và cả hai đang được tham chiếu ở nhiều nơi:
- `OD-11` — 6 chỗ trong code (`admin-online-orders.controller.ts`, `.service.ts`, `-shape.test.ts`,
  `OnlineOrdersQueuePage.tsx`, `packages/schemas/src/admin-online-orders.ts`)
- `OD-12` — 3 chỗ trong `scripts/check-shop-bundle.sh` + `.planning/STATE.md`

**Xử lý:** giữ nguyên OD-11/OD-12, đánh 6 entry mới thành **OD-13..OD-18**. Quan trọng hơn: **giữ
`getOrCreateOpenOrder` ở đúng OD-14** vì `admin-online-orders.service.ts:15` và `09-06-SUMMARY.md` (2
chỗ) đã trỏ tới số đó từ trước. Kết quả: **0 tham chiếu bị vỡ, 0 file code phải sửa** vì lý do đánh số.

Acceptance criterion `grep -c "^## OD-" = 16` do đó không đạt được — con số đúng là **18**. Ghi lại để
người verify không đọc thành thiếu entry.

### 2. [Rule 2] `09-UAT.md` có 6 hạng mục, không phải 5

Plan liệt kê 5. Thêm hạng mục **6: `PUT /admin/settings` qua `AdminGuard`** — việc mà 09-12 không chạy
được vì người thi công không có mật khẩu admin và **không tự đặt lại mật khẩu của chủ dự án**. Bỏ nó
khỏi UAT là để một hạng mục chưa kiểm biến mất khỏi hồ sơ, đúng loại rủi ro T-09-76 nhắm tới.

Đây cũng là hạng mục **duy nhất kiểm được ngay ở local** — bước 12 của checkpoint đóng luôn nó nếu chủ
dự án đã bấm "Lưu câu chữ".

### 3. [Rule 1 — criteria tự-mâu-thuẫn, lần thứ ba trong phase] Comment/chú thích làm grep gate đỏ

Ba criteria dạng `grep = 0` đỏ vì **chính chú thích tôi viết** chứa chuỗi bị cấm:
`grep -c 'chỉ role \`admin\`' REQUIREMENTS.md` (dòng annotation trích lại câu cũ), `grep -c TBD
09-VALIDATION.md` (dòng checklist "không còn `TBD`"), `grep -c 'result: pending' 09-UAT.md` (đoạn văn
mở đầu nhắc lại).

**Sửa:** viết lại lời văn diễn đạt cùng ý mà không nhắc literal. Đây là lần thứ 3 hiện tượng này xảy ra
trong phase 9 (09-11, 09-12, 09-13) — **bài học cho planner:** criteria dạng `grep <chuỗi> = 0` nên
giới hạn phạm vi vào vùng code thi hành, hoặc chấp nhận rằng comment giải thích sẽ vi phạm nó.

### 4. [Rule 1] Tick checkbox `Wave 0 Requirements` mà plan không nhắc

Plan chỉ yêu cầu tick § Validation Sign-Off. Nhưng 6 checkbox § Wave 0 Requirements đều đã hoàn thành
thật (mọi file test liệt kê ở đó tồn tại và xanh) mà vẫn `[ ]` — để nguyên là tài liệu nói sai theo
hướng ngược lại. Đã tick, và đã xác nhận từng file tồn tại bằng `ls` trước khi tick.

**Total deviations:** 4. **Impact:** không đổi phạm vi. Deviation 1 là hệ quả tất yếu của việc plan
được soạn trước 2 plan khác; 2 và 4 làm hồ sơ đầy đủ hơn plan yêu cầu; 3 là lỗi soạn criteria.

## Trạng thái phase 9 sau plan này

- **13/13 plan xong.** ROADMAP bảng Progress: `Executed` + 2026-08-03.
- **REQ-M/N/O vẫn `[ ]`** — chờ `/gsd-verify-work 09`, cố ý không tự tick.
- **6 hạng mục `09-UAT.md` còn treo**, trong đó `docker build` + `sharp` là **gate cứng trước deploy
  production** và chưa từng chạy trong cả 3 phase 7/8/9.
- **Nợ đã ghi ở STATE.md:** `ALTER TABLE` cột `status` sẽ chạy lúc deploy · huỷ đơn không ghi audit log
  (lệch mitigation T-09-80, cần quyết ở phase sau).

## Việc tiếp theo

`/gsd-verify-work 09` để verifier độc lập đối chiếu 5 success criteria, rồi `/gsd-plan-phase 10`
(Analytics — chưa có plan nào).

## Self-Check: PASSED

- `OVERRIDE-DEBT.md` có 18 entry, 6 entry mới đủ 6 nhãn ✓
- `09-UAT.md` tồn tại trên đĩa với 6 hạng mục ✓
- Toàn bộ `<acceptance_criteria>` của Task 1–3 đã chạy lại; 2 criteria không đạt được (tổng 16 entry, 5
  hạng mục UAT) đã ghi thành deviation kèm lý do ✓
- `<verification>` mục 1,2,3,4,5 xanh; mục 6 (checkpoint) **approved** ✓
- Checkpoint KHÔNG tự duyệt: chờ chủ dự án phản hồi rồi mới ghi `approved` + ngày ✓