---
phase: 09-duy-t-n-th-ng-b-o-theo-d-i-n
plan: 07
wave: 4
status: complete
completed_at: 2026-07-31
files_modified:
  - apps/api/src/modules/admin-online-orders/admin-online-orders.controller.ts
  - apps/api/src/modules/admin-online-orders/admin-online-orders.module.ts
  - apps/api/src/modules/admin-online-orders/admin-online-orders.service.ts
  - apps/api/src/modules/audit/audit.interceptor.ts
  - apps/api/src/app.module.ts
verification: typecheck sạch · vitest 200/200 · 8 kịch bản chạy thật trên API + MySQL thật
---

# 09-07 — Controller 4 endpoint duyệt đơn + SSE fan-out

## Đã làm

**`admin-online-orders.controller.ts` (mới)** — `@Controller('admin/online-orders')`, class-level
`@UseGuards(JwtAuthGuard)`, mỗi route có `@UseGuards(RequireRoles('admin', 'order', 'kitchen'))`:

| Route | Ghi chú |
|---|---|
| `GET /admin/online-orders` | chỉ nhận `status=WAITING` (thiếu → mặc định); `Cache-Control: no-store` |
| `POST /admin/online-orders/:id/confirm` | 200, actor lấy từ `req.user` |
| `POST /admin/online-orders/:id/reject` | 200, response `{ ok, reason_code, has_internal_note }` |
| `GET /admin/online-orders/stream` | `@Sse`, heartbeat 15s, `takeUntil(fromEvent(req,'close'))` |

`id` cả 3 route REST đi qua `z.string().uuid()` → 400 nếu sai (T-09-40).

**`audit.interceptor.ts`** — 2 nhánh `deriveActionKind` (`online_order.confirmed` /
`online_order.rejected`) + nhánh `extractTargetKind` → `online_order_request` (khớp `target_kind`
mà emit thủ công của service đang dùng, để 2 nguồn ghi audit của cùng nghiệp vụ lọc ra 1 chỗ).

**`admin-online-orders.service.ts`** — **bỏ emit thủ công `audit.write` cho
`online_order.rejected`** theo chốt của plan này (interceptor đã phủ). Thay bằng 1 dòng
`logger.log`. Emit thủ công còn lại duy nhất là `online_order.table_autocreated` trong
`confirm()`. Đã đo thật: `SELECT action_kind, COUNT(*) … GROUP BY 1` → `rejected` đúng **1** dòng,
không trùng.

**`admin-online-orders.module.ts`** — thêm `controllers` + **`AuthModule`** vào `imports`.
**`app.module.ts`** — thêm `AdminOnlineOrdersModule`.

## Kết quả 8 kịch bản chạy thật

Chạy trên API thật (`localhost:3001`) + MySQL thật, dữ liệu là 5 đơn submit qua
`POST /api/public/orders`.

| # | Kịch bản | Kết quả |
|---|---|---|
| 1 | Không cookie → `GET list`, `confirm`, `stream` | **401** cả 3 (T-09-34, T-09-35) |
| 2 | D-02 — 3 role duyệt được | `GET list`: admin/order/kitchen đều **200**. `confirm` bằng role `order` (user `b`) → 200; bằng role `kitchen` (user `a`) → 200. `reviewed_by_full_name` trong DB = đúng người (`b`, `a`, `Chủ quán`) |
| 3 | Audit ghi đúng | `online_order.confirmed` ×2 (actor `b`, `a`, `target_id` = id đơn), `online_order.rejected` ×1 (actor `admin`), `online_order.table_autocreated` ×2 |
| 4 | D-09 — không lộ ghi chú nội bộ | Response reject = `{"ok":true,"reason_code":"OVERLOADED","has_internal_note":true}`. `after_json` trong audit cũng chỉ có 2 field đó; nội dung ghi chú chỉ nằm ở cột `internal_reject_note` |
| 5 | CSRF (T-09-37) | POST reject **không** header `Origin`, cookie hợp lệ → **403 `CSRF_ORIGIN_MISMATCH`**. Không sửa gì trong `csrf-paths.ts` |
| 6 | 403 role ngoài phạm vi | Tạo user tạm `role='viewer'` → cả 4 endpoint trả **403 `ROLE_FORBIDDEN`**. **User tạm đã xoá sau khi kiểm** |
| 7 | SSE heartbeat | `content-type: text/event-stream`; heartbeat **ngay lúc mở** (`timer(0, …)`) rồi lại sau đúng 15s |
| 8 | SSE event + fan-out + không rò | Event `reviewed` tới sau **242 ms** (< 2s). Mở 2 tab (admin + role `order`) → **cả 2** nhận cùng event. Giữ 3 stream: `Threads_connected` **6 → 6 → 6** (0 connection DB thêm — C-INFRA-01). Đóng hết: log `subscriber đóng, còn 0` |

Biến thể đã dùng cho kịch bản "event < 2s": **`reviewed`**, không phải `new` — vì
`online_order.new` **chưa có ai emit** (grep toàn `apps/api/src` = 0 kết quả ngoài chính
controller). Đó là việc của plan 09-09; plan này cho phép biến thể này tường minh.

`RESEARCH` Pitfall #1 đã xác minh Caddy tự flush `text/event-stream` → **không sửa `Caddyfile`**.
Nếu production sau này thấy trễ > 2s thì kiểm `Content-Type` trước, đừng nghi Caddy.

## Việc phát sinh — đọc trước khi làm 09-08/09-09

### 1. `AuthModule` thiếu trong module → typecheck SẠCH nhưng app chết lúc bootstrap

`JwtAuthGuard` inject `JwtService` + 2 repository. Không có `AuthModule` trong `imports` của
`AdminOnlineOrdersModule` thì Nest ném `Nest can't resolve dependencies of the JwtAuthGuard`
**lúc chạy**, còn `tsc --noEmit` vẫn sạch hoàn toàn. Bất cứ module nào thêm controller có
`JwtAuthGuard` đều phải import `AuthModule` (nếp `SettingsModule` đã làm). Đã ghi comment tại chỗ.

### 2. ⚠️ `pnpm dev` của API KHÔNG đọc `.env` ở repo root — mọi biến bảo mật đang là fallback

`apps/api/src/main.ts:2` dùng `import 'dotenv/config'`, mà dotenv resolve `.env` theo
`process.cwd()`. Script `dev` chạy với cwd = `apps/api`, và **`apps/api/.env` không tồn tại** →
không biến nào trong `.env` root được nạp. Hệ quả đo được:

- `JWT_SECRET` rơi về fallback hardcode **`'dev-secret-CHANGE-ME'`** (`jwt.service.ts:18`).
  Xác minh: token ký bằng secret trong `.env` → **401 `AUTH_INVALID_CRED`**; ký bằng
  `'dev-secret-CHANGE-ME'` → **200**.
- MySQL vẫn kết nối được vì default trong `data-source.ts` tình cờ khớp DB local — nên lỗi này
  **im lặng hoàn toàn**, không ai gặp cho tới khi kiểm secret.
- Các biến còn lại (`COOKIE_SECURE`, `ALLOWED_ORIGIN`, `SETUP_ALLOWED_IP`, `BCRYPT_COST`,
  `JWT_LIFETIME_DAYS`) cũng đang là fallback trên máy dev.

Production **không** bị: `docker-compose.prod.yml` truyền env vào container trực tiếp, không qua
dotenv. Nhưng mọi kiểm thử bảo mật chạy local đều đang chạy trên secret mặc định — đây là thứ
phải sửa trước khi ai đó kết luận "CSRF/JWT đã kiểm xong ở local". Cách sửa gọn nhất: đổi
`import 'dotenv/config'` thành `dotenv.config({ path: resolve(import.meta.dirname, '../../../.env') })`,
hoặc thêm `--env-file=../../.env` vào script `dev`. **Chưa sửa trong plan này** vì ngoài
`files_modified` — đề xuất đưa vào 09-08 hoặc 1 plan hạ tầng riêng.

### 3. `dotenv` v17 in banner ra STDOUT

Bản `dotenv@17` in `◇ injected env (16) from .env` ra **stdout** (không phải stderr). Script nào
`require('dotenv')` rồi `console.log` giá trị ra file sẽ bị lẫn banner. Triệu chứng gặp phải:
Cookie header chứa banner → Node trả **400 rỗng, không log gì**, dễ tưởng là lỗi route.

## 4 acceptance criteria đếm-chuỗi bị STALE, không phải code sai

Đã đưa `api/admin` và `Last-Event-ID` trong comment về **0** bằng cách diễn đạt lại comment.
4 tiêu chí sau **không thể đạt** đúng số plan ghi:

| Criterion | Plan ghi | Thực tế | Lý do |
|---|---|---|---|
| `RequireRoles('admin', 'order', 'kitchen')` | 3 | **4** | Criterion viết ở Task 1 (3 route REST). Task 2 thêm route SSE cũng phải có guard này → 4 mới là đúng bảo mật |
| `internal_note` trong controller | 0 | **3** | Chính Task 1 về sau lại yêu cầu response có `has_internal_note` (chứa substring `internal_note`), và phải đọc `parsed.data.internal_note` để tính boolean đó. Criterion viết cho bản nháp trước khi action được sửa. Yêu cầu thật — response không chứa **nội dung** ghi chú — đã kiểm ở kịch bản 4 |
| `takeUntil` | 1 | **3** | Dòng `import`, 1 comment giải thích, 1 chỗ dùng. Kể cả bỏ comment vẫn còn 2 (import + dùng) — số 1 không đạt được |

Đề nghị sửa 3 con số này trong plan/verifier để phase sau không bị đánh trượt oan.

## Nợ để lại

- **Dữ liệu test còn trong DB dev:** 5 `online_order_requests` (`Khach Test A`–`E`), trong đó 3 đã
  CONFIRMED → sinh **3 `orders` thật** + **3 bàn tự tạo** (`mang-ve-01/02/03`). Chúng **sẽ hiện
  trong doanh thu / lịch sử / sơ đồ bàn**. Plan 09-08 đếm trước-sau nên không bị sai lệch, nhưng
  nếu muốn DB sạch thì xoá theo `online_request_id IS NOT NULL` + 3 bàn đó. **Chưa tự xoá** vì
  cascade sang bảng thật.
- `online_order.new` chưa ai emit → nhánh `new` của SSE chưa được kiểm end-to-end (plan 09-09).
- `AuditInterceptor` ghi `actor_name` từ `req.user.name` (= **username**), không phải `full_name`.
  Nên audit hiện `b`/`a`/`admin` còn `reviewed_by_full_name` hiện `Chủ quán`. Vẫn truy được đúng
  người, nhưng 2 cột lệch nhau về cách gọi tên — hành vi có từ Milestone 1, **không sửa** trong
  plan này để không đổi nghĩa toàn bộ audit log cũ.
