# Test Strategy — Phase 08 (Public Menu, Checkout & Công Tắc Nhận Đơn)

**Nguồn:** `CONTEXT.md` P08.D-56..D-65, D-73..D-76 · 46 kịch bản TS-01..TS-46
**Bản nháp sinh ở:** `/vg:scope` STEP 6 §5 — `/vg:blueprint` sẽ chuyển thành `TEST-GOALS.md`
**Môi trường:** `local` cho cả review/test/roam/accept (P08.D-72 — không deploy)

---

## Điểm khởi đầu: repo có 0 file test

`find -name "*.spec.ts"` → **0**. `apps/api/package.json:11` có `"test": "vitest run"` trỏ vào
chỗ trống. Phase 01 có `TEST-STRATEGY.md` hứa MySQL test container nhưng chưa bao giờ dựng.

Nên phase 08 phải dựng hạ tầng test **từ 0**, và đó là việc đầu tiên trong PLAN, không phải
việc cuối:

| Cần dựng | Vì sao chặn |
|---|---|
| `vitest.config.ts` cho `apps/api` | Không có thì `pnpm test` không chạy được gì |
| `.env.test` + DB test tách biệt | **Chốt cứng:** test `UPDATE expires_at` (P08.D-56) tuyệt đối không được chạy vào DB production |
| Fixture seed menu + bàn + đơn | TS-09, TS-15, TS-43 đều cần dữ liệu có sẵn |
| Snapshot baseline error envelope | TS-34 so trước/sau khi đổi `global-exception.filter.ts` |

---

## Tháp kiểm thử

Solo dev, quán 1 chi nhánh — không làm tháp đầy đủ. Ưu tiên theo **rủi ro thật**, không theo
độ phủ dòng code.

| Tầng | Bao nhiêu | Dùng cho |
|---|---|---|
| Unit | ~12 | Hàm thuần: `normalizePhone`, `stripDiacritics`, `haversineKm`, `isStoreOpenNow(now)`, `isOrderExpired(order, now)`, tính `expires_at` = `min(gửi+45', giờ đóng)` |
| Integration (API) | ~28 | Phần lớn TS. Gọi endpoint thật trên DB test, assert cả response **và** trạng thái DB |
| E2E (browser) | ~6 | Chỉ luồng khách không thể verify bằng API: xem menu → thêm giỏ → checkout → nhận token; giỏ sống qua F5; banner khi OFF |
| Manual | 1 | TS-18 chia sẻ vị trí trên HTTPS thật — `local` không có HTTPS nên **mark MANUAL**, điền ở `/vg:accept` |

**Không viết E2E cho POS nội bộ** (P08.D-60) — thay bằng 3 test tập trung + checklist tay.

---

## Bốn nhóm rủi ro cao nhất

### 1. Đơn WAITING làm bẩn dữ liệu POS (rủi ro **Cao** — §10 spec M2)
- **TS-09** — gọi `/orders/stats` + `/tables` + `/orders` (bếp) + `/history` trước/sau khi tạo
  5 đơn WAITING, assert **từng con số** y nguyên. Đo cái người dùng thấy, không phải đếm SQL.
- Chiến lược: `fixture` tạo 5 đơn ở đúng trạng thái WAITING, không đi qua UI.

### 2. Sửa 4 điểm dùng chung làm hồi quy POS (rủi ro **Cao**)
Phase 08 sửa `main.ts` (SPA fallback), `global-exception.filter.ts`, `csrf-origin.middleware.ts`,
và thêm subclass `ThrottlerGuard` — mọi màn POS chạy qua cả 4.

- **TS-38** bảng định tuyến ở chế độ production: `(Host, path, Accept)` → loại nội dung. Gồm
  `/api/public/menu` + `Accept: text/html` vẫn phải trả **JSON**.
- **TS-34** snapshot đóng băng error envelope cho 401/403/404/409/422/429 từ endpoint POS **hiện
  có**, so trước/sau. Gồm `AUTH_RATE_LIMITED` ở lần login thứ 6 và `ADMIN_REQUIRED` khi staff
  gọi `/admin/users`.
- **Ma trận CSRF** gồm origin giả mạo `https://order.example.com.evil.com` → 403; mọi origin
  thật → 200; `POST /api/public/orders` từ browser **và** từ curl không header Origin → cả hai 201.
- **Checklist tay** sau khi sửa: login · sơ đồ bàn · trang bếp · thanh toán · nhật ký bàn.

### 3. Rate limit đếm sai IP sau proxy (rủi ro **Cao**)
`app.set('trust proxy', 1)` — số hop sai thì 60 req/phút thành giới hạn cho **toàn bộ khách
cùng lúc**. **Test một client duy nhất pass y hệt trong cả trường hợp đúng và sai** — nên bắt
buộc 4 cách kiểm của P08.D-61:
- 2 client `X-Forwarded-For` khác nhau (A hết quota → B vẫn 200)
- Chuỗi giả mạo `1.2.3.4, <ip thật>` không reset được bộ đếm
- Load probe 10 client poll 2 giây trong 60 giây → POS **không** có 429 nào
- Kiểm tay trên VPS thật sau Caddy thật *(chưa làm được vì `local`, đánh dấu DEFERRED)*

### 4. Khách bị giam sau 409 vì khoá SĐT không nhả (rủi ro Trung bình)
- **P08.D-62 ma trận chuyển trạng thái** đầy đủ: WAITING → CANCELLED / REJECTED / EXPIRED /
  CONFIRMED, và PATCH khi WAITING.
- **Invariant thường trực**: query `open_phone_lock IS NOT NULL AND status <> 'WAITING'` phải
  trả **0** — chạy sau mọi test làm đổi trạng thái.
- **Một normalizer duy nhất** dùng cho cả blacklist lẫn cột lock — unit test dùng chung.

---

## Chiến lược tua thời gian (P08.D-56)

Không dùng fake timers vì `@nestjs/schedule @Cron` đọc đồng hồ hệ thống. Thay vào đó:

| Cần tua | Cách làm |
|---|---|
| Đơn hết hạn 45 phút (TS-16) | `isOrderExpired(order, now)` nhận `now` → gọi trực tiếp với mốc tuỳ ý; cộng 1 test API `UPDATE expires_at` về quá khứ rồi gọi endpoint |
| Tự ON lại 00:00 giờ VN (TS-17) | `isStoreOpenNow(now)` nhận `now`; assert với `now` ở 23:59 và 00:01 giờ Asia/Ho_Chi_Minh |
| Giờ chốt đơn (TS-28) | `now` = 21:31 với `open_hours` đóng 22:00 và ngưỡng 30 phút |
| Ẩn danh hoá 90 ngày (TS-31) | Fixture tạo đơn với `created_at` 91 ngày trước, chạy hàm ẩn danh hoá trực tiếp |

Chạy trong milliseconds, không cần đợi, không sửa đồng hồ hệ thống.

---

## Assertion allowlist dương (P08.D-65)

Không kiểm điểm. So **tập khoá chính xác** của cả 5 response public với danh sách đã commit,
đệ quy. Mục đích: cột nào thêm vào `menu_items` hay `online_order_requests` sau này (ghi chú từ
chối của admin, `ip_hash`, `user_agent`) **mặc định làm test fail** thay vì âm thầm lọt ra
endpoint công khai.

Áp cho: `GET /store`, `GET /menu`, `GET /orders/:token`, `GET /orders`, và response `POST /orders`.

---

## Gate giao diện

| Gate | Mức | Ghi chú |
|---|---|---|
| `impeccable detect apps/shop/src` | **BLOCK** ở verdict `error` | 60 rule tất định, chạy <5s, không tốn token. Bắt lệch design system + "trông như UI do AI sinh" |
| Ngân sách bundle route `/` ≤ 150KB gzip | **WARN** | 3 file font ~110KB đã chiếm gần hết; vượt vì lý do hợp lý thì không chặn ship |
| axe-core | BLOCK ở violation | Tương phản đã tính sẵn trong `tokens.css`; test xác nhận không bị phá khi render |
| Touch target ≥ 44×44, input ≥ 16px | BLOCK | Dưới 16px Safari iOS tự zoom khi bấm vào ô |

---

## Ngân sách thời gian chạy

| Nhóm | Mục tiêu |
|---|---|
| Unit | < 5s |
| Integration | < 90s (có DB test) |
| E2E | < 120s (6 luồng, chỉ Chromium) |
| Gate giao diện | < 15s |
| **Tổng** | **< 4 phút** — quá mức này thì solo dev sẽ ngừng chạy test |

---

## Chưa verify được ở môi trường `local`

Ghi rõ để `/vg:review` không mark FAILED oan:

| TS | Vì sao | Nhãn |
|---|---|---|
| TS-18 chia sẻ vị trí | Geolocation API cần HTTPS thật; `local` là HTTP | `manual` |
| P08.D-61(d) rate limit sau Caddy thật | Cần VPS thật, mà P08.D-72 cấm deploy | `DEFERRED` |
| P08.D-63 deploy lần đầu trên bản sao prod | Cần dump DB production | `DEFERRED` — làm khi chủ quán cho phép |
| TS-23 TTI < 3s Slow-4G | Đo được bằng DevTools throttle nhưng số liệu local không phản ánh VPS | `WARN-only` |

---

## Status

**Bản nháp** — `/vg:blueprint 08` sẽ chuyển thành `TEST-GOALS.md` có ID `G-XX` gắn với từng
quyết định `P08.D-XX` và từng endpoint. Con số kịch bản có thể tăng khi blueprint tách
`interactive_controls` (bộ lọc / tìm kiếm / phân trang) thành goal riêng.
