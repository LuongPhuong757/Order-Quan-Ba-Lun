---
status: testing
phase: 08-menu-cong-khai-checkout-cong-tac-nhan-don
source: [08-01-SUMMARY.md, 08-02-SUMMARY.md, 08-03-SUMMARY.md, 08-04-SUMMARY.md, 08-05-SUMMARY.md, 08-06-SUMMARY.md, 08-07-SUMMARY.md, 08-08-SUMMARY.md, 08-09-SUMMARY.md, 08-10-SUMMARY.md, 08-11-SUMMARY.md, 08-12-SUMMARY.md]
started: 2026-07-31
updated: 2026-07-31
---

# Phase 8 — Deferred UAT

**Đây KHÔNG phải blocker của phase 8 để đóng phase.** Toàn bộ Milestone 2 làm LOCAL ONLY (C-LOCAL-01), nên
5 hạng mục dưới đây chỉ nghiệm thu được khi chủ dự án tự deploy, hoặc khi có máy/CI có Docker.

**Khác với 7 hạng mục của `07-UAT.md`** (tất cả đều "chờ chủ dự án deploy khi muốn"): **test 1 dưới đây là
GATE BẮT BUỘC TRƯỚC KHI DEPLOY PRODUCTION**, không chỉ trước khi đóng phase. `sharp` là dependency native
đầu tiên của `apps/api` — nếu build image thất bại trên alpine, admin không upload được ảnh món nào, và ảnh
món là nội dung chính của trang khách. Không được deploy production khi test 1 chưa xanh.

## Current Test

number: —
name: chưa bắt đầu (chờ chủ dự án deploy hoặc chờ có máy/CI có Docker)
expected: |
  Không có test nào trong file này được chạy trên môi trường thật ở phase 8 — theo đúng mandate LOCAL ONLY.
  Toàn bộ phần logic tương ứng (auto-revert công tắc, resize ảnh, parse Maps) đã có test tự động xanh —
  xem `08-VALIDATION.md` § Per-Task Verification Map.
awaiting: chủ dự án chủ động deploy khi muốn, hoặc có máy/CI có Docker để chạy test 1 sớm hơn

## Tests

### 1. [GATE BẮT BUỘC TRƯỚC KHI DEPLOY PRODUCTION] Docker image build được và `sharp` chạy trên alpine

expected: `docker build -t order-api .` xong không lỗi; chạy container, upload 1 ảnh JPG ≥ 2 MB qua trang
quản lý menu, xác nhận file ra là `.webp` rộng ≤ 800px và < 300 KB.
result: pending
local_substitute: |
  Không có — máy dev không có Docker (`07-UAT.md` test 6, xác nhận lại ở `08-RESEARCH.md` §Environment
  Availability). Đã giảm thiểu rủi ro trước bằng cấu hình (không phải bằng chạy thật):
  - `pnpm.supportedArchitectures` ở root `package.json` khai `current` + `linux` (xác nhận: `grep -c
    "supportedArchitectures" package.json` = 1, theo `08-03-SUMMARY.md`)
  - `pnpm-lock.yaml` đã chứa 3 dòng biến thể `sharp-linuxmusl-x64` (xác nhận:
    `grep -c "sharp-linuxmusl-x64" pnpm-lock.yaml` = 3, theo `08-03-SUMMARY.md`)
  - `engines.node` đã siết thành `>=20.9.0` (đúng yêu cầu thật của `sharp@0.35.3`, không phải `>=20` lỏng
    như trước)
  - Pipeline resize (`sharp().rotate().resize({width:800}).webp({quality:82}).toFile()`) đã verify bằng
    script gọi trực tiếp với ảnh giả lập worst-case (4032×3024, EXIF orientation=6, ~9.6MB nhiễu ngẫu
    nhiên) trên macOS — ra đúng 800×1067 webp 299.8KB, giữ đúng chiều dọc. **Đây KHÔNG chứng minh sharp
    load được trên alpine/musl** — chỉ chứng minh logic resize đúng trên nền tảng đã build được.
steps: |
  Nếu build lỗi `Could not load the sharp module`, kiểm theo đúng thứ tự:
  1. Khối `pnpm.supportedArchitectures` ở root `package.json` — phải có `linux` + `musl` (hoặc `current`
     không đủ nếu build chạy trên máy khác kiến trúc image đích)
  2. `pnpm-lock.yaml` có dòng biến thể `@img/sharp-linuxmusl-x64` — nếu không có, xoá lockfile và
     `pnpm install` lại SAU KHI đã có `supportedArchitectures` đúng
  3. `engines.node >= 20.9.0` — `Dockerfile` dùng `node:20-alpine` (floating tag, luôn kéo bản mới nhất
     nhánh 20), nên rủi ro này chủ yếu ảnh hưởng máy dev cũ, không phải production
  Sau khi build xong, chạy container và upload 1 ảnh JPG thật (không phải ảnh giả lập) qua
  `/menu` (apps/web) để xác nhận đầu-cuối, không chỉ tin script giả lập.
⚠ **Không được deploy production khi test này chưa xanh.**

### 2. `Permissions-Policy: geolocation=(self)` serve thật trên `order.` (M2.D-69)

depends_on: 07-UAT.md test 3
expected: header `Permissions-Policy: geolocation=(self)` có mặt khi `curl -sI https://order.<domain>`,
và `geolocation=()` ở apex.
result: pending
local_substitute: |
  Không thể — header này chỉ do Caddy set, Vite dev server không set (đã ghi ở `07-UAT.md` test 3). Local
  chỉ review được text trong `Caddyfile`.
steps: |
  Xem đầy đủ ở `07-UAT.md` test 3. Hệ quả cụ thể nếu header sai (khác `07-UAT.md`, nhấn mạnh lại cho phase
  8): nút "Chia sẻ vị trí" ở `/checkout` **im lặng không chạy** dù code React hoàn toàn đúng — trình duyệt
  tự chặn `navigator.geolocation` ở tầng Permissions Policy trước khi JavaScript kịp chạy.
  **Khách không thấy lỗi gì cả** (không có banner, không có exception) — nút chỉ đơn giản không phản ứng
  khi bấm, dễ bị hiểu nhầm là "bug ở FE" trong khi nguyên nhân là hạ tầng Caddy.
severity_if_fail: major — khách DELIVERY mất tính năng chia sẻ vị trí (vẫn đặt được hàng bằng địa chỉ tay,
  không chặn luồng chính, nhưng mất tiện ích chính mà REQ-J hứa hẹn)

### 3. Geolocation trong WebView Zalo/Facebook

expected: khách bấm "Chia sẻ vị trí" trong WebView Zalo/Facebook trên điện thoại thật — nếu WebView chặn
Geolocation thì hiện dòng "Không lấy được vị trí..." (trạng thái `failed` của `useGeolocation()`) và
**vẫn đặt được hàng** bằng địa chỉ nhập tay. Đây là điều kiện chấp nhận — **không phải** "Geolocation phải
chạy được trong mọi WebView".
result: pending
local_substitute: |
  Không có tài liệu chính thức từ Zalo/Facebook về hành vi Geolocation trong WebView tuỳ biến của họ (đã
  ghi ở `08-RESEARCH.md` Pitfall 4) — chỉ suy luận từ pattern in-app-browser chung. `useGeolocation()` đã
  có test tự động cho phần map 3 mã lỗi Geolocation (`PERMISSION_DENIED`/`POSITION_UNAVAILABLE`/`TIMEOUT`)
  về cùng 1 trạng thái `'failed'`, nhưng phần "WebView có chặn API hay không" chỉ kiểm được trên thiết bị
  thật.
steps: |
  1. Gửi link `order.<domain>` qua tin nhắn Zalo, mở bằng WebView Zalo trên iPhone thật
  2. Lặp lại trên Android thật
  3. Lặp lại cả 2 bước trên qua WebView Facebook (Messenger)
  4. Ở mỗi lần: vào `/checkout`, chọn DELIVERY, bấm "Chia sẻ vị trí của bạn"
  5. Nếu WebView chặn: xác nhận dòng chữ "Không lấy được vị trí..." hiện đúng, và khách **vẫn** điền được
     địa chỉ tay + bấm ĐẶT HÀNG thành công (không có gì chặn nút submit vì Geolocation thất bại)

### 4. Ảnh cũ upload trước phase 8 vẫn xem được

expected: các `image_url` trỏ file JPG/PNG cũ trong `uploads/menu/` (upload trước khi có bước resize D-12)
vẫn hiện bình thường trên trang khách — bước resize chỉ áp cho ảnh upload **mới**, không có migration ảnh
cũ, nên card món dùng ảnh cũ phải render đúng dù file không phải webp/không đúng 800px.
result: pending
local_substitute: |
  Kiểm được ở local NẾU DB local đã có món với `image_url` trỏ ảnh JPG/PNG cũ (upload trước plan 08-03).
  Nếu DB local trống hoặc mọi ảnh hiện có đều đã qua bước resize mới, hạng mục này phải kiểm trên dữ liệu
  production thật (nơi chắc chắn có ảnh cũ tồn tại từ trước Milestone 2).
steps: |
  1. Mở `pnpm --filter @order/shop dev` → http://localhost:5174/
  2. Tìm món có ảnh cũ (không phải webp, hoặc kích thước khác 800px) — kiểm bằng cách mở `image_url` trực
     tiếp trên trình duyệt xem định dạng file
  3. Xác nhận card món đó hiện ảnh bình thường (không vỡ, không 404) — `<img>` với `object-fit: cover` xử
     lý được mọi tỉ lệ khung hình gốc, không phụ thuộc ảnh đã qua resize hay chưa

### 5. Kích thước bundle khách trên mạng 3G thật

expected: trang menu hiện được nội dung đầu (header + vài card món đầu tiên) trong khoảng 5 giây trên
mạng 3G thật.
result: pending
local_substitute: |
  Gate đo lường: `scripts/check-shop-bundle.sh` — `MAX_JS_KB=370` (đo thật lúc đóng plan 08-11: 336 kB +
  ~10% chừa cho plan 08-12; số đo thật hiện tại tại thời điểm đóng phase: **348 kB / 370 kB**, còn ~6%
  margin — xem `08-12-SUMMARY.md`). Số ban đầu ở plan 08-04 là `MAX_JS_KB=320` (đo 244 kB + ~30%) trước khi
  có router/checkout đầy đủ; ngưỡng đã được nâng 2 lần theo đúng quy tắc tự đặt ("nâng ngưỡng phải sửa số
  này + ghi lý do, không sửa lặng") — không phải sửa lặng, không phải lệch spec (320 kB chưa từng là số
  spec-pin, chỉ là ngân sách tự đặt dựa trên số đo thật).
  Bổ sung: throttling "Slow 3G" trong Chrome DevTools khi mở `pnpm --filter @order/shop dev`.
steps: |
  1. Chrome DevTools → Network → Throttling → "Slow 3G"
  2. Reload http://localhost:5174/ (hoặc bản build `vite preview` để đo đúng bundle production)
  3. Quan sát thời điểm header + card món đầu tiên render — phải trong khoảng ~5 giây
  4. Nếu chậm hơn nhiều: kiểm `sh scripts/check-shop-bundle.sh` trước — nếu gate đang xanh mà vẫn chậm
     trên 3G thật, vấn đề nằm ở ảnh (chưa qua resize D-12) hoặc font, không phải JS bundle

---

## Ghi chú cho lúc deploy

- **Thứ tự khuyến nghị:** test 1 (Docker/sharp) là gate bắt buộc, làm trước hoặc song song với các test
  hạ tầng còn lại của `07-UAT.md` (test 6/7 — cùng cần Docker). Sau khi có DNS + TLS (`07-UAT.md` test 1-2)
  mới kiểm được test 2/3 (Geolocation phụ thuộc HTTPS + domain thật).
- Test 4 và 5 không phụ thuộc Docker/DNS — có thể kiểm ngay khi có dữ liệu ảnh cũ / mạng 3G thật để mô
  phỏng, không cần chờ hạ tầng.
