---
status: testing
phase: 09-duy-t-n-th-ng-b-o-theo-d-i-n
source: [09-01-SUMMARY.md, 09-02-SUMMARY.md, 09-03-SUMMARY.md, 09-04-SUMMARY.md, 09-05-SUMMARY.md, 09-06-SUMMARY.md, 09-07-SUMMARY.md, 09-08-SUMMARY.md, 09-09-SUMMARY.md, 09-10-SUMMARY.md, 09-11-SUMMARY.md, 09-12-SUMMARY.md]
started: 2026-08-03
updated: 2026-08-03
---

# Phase 9 — Deferred UAT

**Đây KHÔNG phải blocker để đóng phase 9.** Milestone 2 làm LOCAL ONLY (C-LOCAL-01), nên các hạng mục
dưới đây chỉ nghiệm thu được khi chủ dự án tự deploy, có thiết bị thật, hoặc có dịch vụ thật.

⚠ **Không nhầm với checkpoint `09-13-PLAN.md` Task 4** (14 bước luồng duyệt đơn + theo dõi đơn chạy ở
local). Approval đó CHỈ xác nhận phần chạy được ở local; **6 hạng mục trong file này vẫn
chưa nghiệm thu** — status frontmatter giữ nguyên `testing`.

⚠ **Hạng mục 5 là GATE BẮT BUỘC TRƯỚC KHI DEPLOY PRODUCTION**, kế thừa từ `08-UAT.md` test 1 và
**vẫn chưa được đóng**. Ghi lại ở đây để nó không rơi khỏi tầm mắt khi phase 8 đã đóng.

---

### 1. Chuông báo đơn trên Safari / iOS thật

result: pending
blocks_phase: no
blocks_production: no

`09-RESEARCH.md` Assumption A2: Safari dùng **Media Engagement Index** thay vì chỉ "một lần user
gesture" như Chrome, nên có thể đòi gesture **lặp lại** hoặc chặn `AudioContext.resume()` theo cách
khác. Local chỉ kiểm được trên Chrome desktop.

`bell.ts` dùng Web Audio API (`AudioContext` + `OscillatorNode`) — xem `OVERRIDE-DEBT.md` **OD-17** —
và **không có test tự động** (`AudioContext` không tồn tại trong vitest thuần), nên đây là hạng mục
chỉ kiểm được bằng tai trên thiết bị thật.

**Cách kiểm:** mở `/admin/online-orders` trên iPhone (Safari), bấm "Bật chuông" → phải nghe 1 tiếng
xác nhận ngay. Đặt 1 đơn từ trang khách → phải nghe chuông. Khoá màn hình rồi mở lại → kiểm chuông
còn kêu không.

**Nếu hỏng:** nhân viên dùng iPhone sẽ không nghe được đơn mới. Đường lùi: thay ruột `bell.ts` bằng
`HTMLAudioElement` + file `.mp3` (giao diện `unlock`/`ring`/`dispose` giữ nguyên nên trang không phải
sửa) — xem OD-17 § "Quay lại thì sao".

---

### 2. SSE xuyên Caddy trên production

result: pending
blocks_phase: no
blocks_production: no

`09-RESEARCH.md` Assumption A1 (Caddy tự flush `text/event-stream`, không buffer) mới chỉ xác minh
**qua tài liệu**, chưa chạy thật — máy dev không có Docker lẫn `caddy` CLI (nợ kế thừa từ `07-UAT.md`
test 6 và 7).

Local đã đo SSE đầu-cuối **403 ms** (plan 09-09) nhưng đó là đo trực tiếp vào API, không qua reverse
proxy.

**Cách kiểm:** sau deploy, mở `/admin/online-orders` qua domain thật, đặt đơn từ trang khách, bấm giờ
tới lúc dòng đơn xuất hiện. ROADMAP criterion 1 đòi **< 2s**.

**Nếu trễ > 2s:** kiểm `Content-Type: text/event-stream` và header `X-Accel-Buffering`/`flush` **trước**
khi nghi Caddy. Nguyên nhân thường gặp hơn là response bị nén hoặc thiếu `Cache-Control: no-cache`.

---

### 3. `SMS_DRIVER=esms` với brandname thật

result: pending
blocks_phase: no
blocks_production: **có thể** — xem dưới

Local chỉ kiểm được nhánh **thiếu key** (driver `console` in ra log). Chưa gửi một tin SMS thật nào
qua eSMS.

⚠ **Mức quan trọng đã TĂNG sau phase 9.** `OVERRIDE-DEBT.md` **OD-15** bỏ hẳn auto-OFF, nên lớp SMS
90s (L2) nay là **lớp duy nhất còn tới được người không ngồi trước máy**. Trước đây nếu SMS hỏng thì
vẫn còn auto-OFF làm lưới cuối; nay không còn gì.

**Cách kiểm:** đặt `SMS_DRIVER=esms` + key thật + brandname đã đăng ký, để 1 đơn quá 90s không duyệt,
xác nhận điện thoại nhận được tin.

**Nếu hỏng:** đơn đặt lúc không ai ngồi trước máy sẽ không ai biết — đúng loại "bỏ lọt đơn" mà REQ-N
sinh ra để chống. Nên coi đây là gate trước khi tin vào cảnh báo 90s, dù không chặn việc deploy.

---

### 4. Nhiều instance API cùng chạy

result: pending
blocks_phase: no
blocks_production: no

Poller outbox có `SELECT ... FOR UPDATE SKIP LOCKED` + guard in-process, nhưng **chưa kiểm với 2
container** cùng chạy. Rủi ro còn lại: cùng một hàng outbox bị gửi 2 lần (khách/quán nhận 2 SMS).

Rủi ro này đã được **chấp nhận có ý thức** ở T-09-22 — hiện production chạy 1 instance.

**Cách kiểm:** chạy 2 instance API trỏ cùng DB, đặt 1 đơn, chờ quá 90s, đếm số tin gửi ra (phải là 1).

**Khi nào cần:** trước lần đầu scale lên nhiều instance, không phải bây giờ.

---

### 5. `docker build` + `sharp` trên alpine — GATE BẮT BUỘC TRƯỚC DEPLOY

result: pending
blocks_phase: no
blocks_production: **CÓ — gate cứng**

**Kế thừa nguyên trạng từ `08-UAT.md` test 1, chưa được đóng.** `sharp` là dependency native đầu tiên
của `apps/api`. Nếu build image thất bại trên alpine thì admin không upload được ảnh món nào — và ảnh
món là nội dung chính của trang khách.

Máy dev không có Docker (nợ từ `07-UAT.md` test 6/7), nên `docker build` **chưa từng chạy một lần
nào** trong cả 3 phase 7/8/9.

**Cách kiểm:** `docker build -t oqbl-api --target api .` trên máy có Docker, rồi upload 1 ảnh món qua
`/admin/menu` trong container.

**Không được deploy production khi hạng mục này chưa xanh.**

---

### 6. `PUT /admin/settings` qua `AdminGuard` — 2 key câu chữ

result: pending
blocks_phase: no
blocks_production: no

Plan 09-12 Task 1 thêm 2 key `closed_banner_text` / `closed_submit_confirm_text` với **round-trip 3
chỗ**. Đã chứng minh được đoạn DB → `readAll()` → `GET /api/public/store` giữ đủ **500 ký tự** không
bị cắt, và grep khẳng định 2 key có trong `SETTINGS_DEFAULTS` + mảng allowlist của controller.

**Chưa chạy:** đúng lượt `PUT /admin/settings` đi qua `AdminGuard` + DTO `class-validator`. Người thi
công không có mật khẩu tài khoản `admin` và **không tự đặt lại mật khẩu của chủ dự án**.

Đây là hạng mục nhỏ nhất trong file, và là hạng mục duy nhất **kiểm được ngay ở local** — chỉ cần chủ
dự án đăng nhập.

**Cách kiểm (~30 giây):** đăng nhập `/admin/settings` → sửa ô "Câu hiển thị trên trang khách khi Đóng
cửa" → bấm **Lưu câu chữ** → thấy toast xanh → F5 → chữ vẫn còn.

**Nếu hỏng:** triệu chứng là **toast xanh nhưng F5 mất chữ** — đó đúng là lỗi "nuốt lặng lẽ" mà
T-09-68 nhắm tới (`updateMany` có `if (!kind) continue`). Khi đó kiểm mảng allowlist trong
`settings.controller.ts` trước.

---

## Tổng kết

| # | Hạng mục | Chặn phase 9? | Chặn deploy production? | Kiểm được ở local? |
|---|----------|---------------|-------------------------|--------------------|
| 1 | Chuông trên Safari/iOS | Không | Không | Không (cần iPhone) |
| 2 | SSE xuyên Caddy | Không | Không | Không (cần Docker/Caddy) |
| 3 | `SMS_DRIVER=esms` thật | Không | Nên có trước khi tin vào cảnh báo 90s | Không (cần key eSMS) |
| 4 | Nhiều instance API | Không | Không (hiện 1 instance) | Không |
| 5 | `docker build` + `sharp` | Không | **CÓ — gate cứng** | Không (cần Docker) |
| 6 | `PUT /admin/settings` | Không | Không | **CÓ — cần 1 lần đăng nhập admin** |