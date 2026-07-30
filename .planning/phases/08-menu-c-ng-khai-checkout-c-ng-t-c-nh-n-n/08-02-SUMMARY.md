---
phase: 08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n
plan: 02
subsystem: database
tags: [typeorm, mysql, entity, schema, synchronize]

# Dependency graph
requires:
  - phase: 07-shop-infra
    provides: apps/shop scaffold, apps/api public module (health endpoint), data-source.ts pattern
provides:
  - 3 entity mới đúng §4 spec (store_settings, phone_blacklist, online_order_requests) — TỒN TẠI THẬT trong MySQL, xác nhận bằng truy vấn information_schema
  - data-source.ts đăng ký đủ 13 entity (mảng entities tường minh, không autoload)
  - CLI `pnpm --filter @order/api schema:verify` — gate kiểm bảng/cột thật, tái sử dụng cho phase 9+
  - IP_HASH_SALT khai trong .env.example + .env.production.example
affects: [08-05, 08-10, 09-approval-notification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CLI đứng riêng dưới src/cli/ PHẢI tự `import 'dotenv/config'` — chỉ main.ts làm việc này tự động, cron-jti-cleanup.ts/cron-audit-retention.ts thiếu bước này nên 'chết im' theo đúng ghi chú STATE.md"
    - "Cột decimal (customer_lat/lng, distance_km) khai kiểu TS string | null — mysql2 trả decimal dạng string, không tự ép number"

key-files:
  created:
    - apps/api/src/modules/settings/entities/store-settings.entity.ts
    - apps/api/src/modules/settings/entities/phone-blacklist.entity.ts
    - apps/api/src/modules/public/entities/online-order-request.entity.ts
    - apps/api/src/cli/verify-schema.ts
  modified:
    - apps/api/src/data-source.ts
    - apps/api/package.json
    - .env.example
    - .env.production.example

key-decisions:
  - "Giữ nguyên tên bảng/cột đúng 100% theo §4 spec — không có cơ hội sửa sau vì synchronize:true không migration (C-SCHEMA-07)"
  - "verify-schema.ts là gate (exit 1 khi thiếu), không phải báo cáo — không được nới điều kiện nếu thiếu cột/bảng"

patterns-established:
  - "Task [BLOCKING] xác nhận schema thật: khởi động apps/api để synchronize chạy, rồi truy vấn information_schema — không tin typecheck/build"

requirements-completed: [REQ-K, REQ-L, REQ-J]

# Metrics
duration: ~45min
completed: 2026-07-30
---

# Phase 8 Plan 02: Entity mới + xác nhận schema thật trong MySQL Summary

**3 bảng mới (`store_settings`, `phone_blacklist`, `online_order_requests`) đúng §4 spec, đăng ký vào `data-source.ts`, và xác nhận TỒN TẠI THẬT trong MySQL qua `information_schema` — không chỉ typecheck.**

## Performance

- **Duration:** ~45 phút (bao gồm cài đặt lại node_modules + build packages cho worktree mới)
- **Started:** 2026-07-30T04:xx (sau khi đọc context)
- **Completed:** 2026-07-30T05:14:19Z
- **Tasks:** 3/3
- **Files modified:** 8 (4 tạo mới, 4 sửa)

## Accomplishments
- 3 entity TypeORM đúng tên bảng/cột spec §4.1/§4.2/§4.3, đủ index (unique `order_token`, 4 composite index cho gap lock + rate limit theo cửa sổ thời gian)
- `data-source.ts` khai đủ 13 entity trong mảng `entities` tường minh (không autoload)
- CLI `pnpm --filter @order/api schema:verify` — gate kiểm `information_schema.COLUMNS` thật, exit 1 nếu thiếu bảng/cột
- **Xác nhận bằng MySQL thật (không phải typecheck):** khởi động `apps/api`, `synchronize: true` tạo đủ 3 bảng, `schema:verify` trả `"ok": true`, và kiểm chéo độc lập bằng `SHOW TABLES`/`DESCRIBE` khớp 100% với spec §4
- `IP_HASH_SALT` (M2.D-56) khai trong cả `.env.example` (dev default) và `.env.production.example` (placeholder bắt buộc đổi)

## Task Commits

Each task was committed atomically:

1. **Task 1: 3 entity mới theo §4 spec** - `ea3a312` (feat)
2. **Task 2: Đăng ký entity vào data-source + CLI kiểm schema + IP_HASH_SALT trong 2 file env mẫu** - `2c63a5b` (feat)
3. **Task 3: [BLOCKING] Xác nhận bảng mới tồn tại THẬT trong MySQL** - `8cd90dd` (fix — sửa bug dotenv phát hiện trong lúc chạy Task 3)

**Plan metadata:** (commit này, tạo bởi executor sau khi hoàn tất — SUMMARY + self-check)

## Files Created/Modified
- `apps/api/src/modules/settings/entities/store-settings.entity.ts` - bảng key-value `store_settings` (§4.1)
- `apps/api/src/modules/settings/entities/phone-blacklist.entity.ts` - bảng `phone_blacklist` (§4.3), `expires_at` NULL = vĩnh viễn
- `apps/api/src/modules/public/entities/online-order-request.entity.ts` - bảng `online_order_requests` (§4.2), đủ 25 cột + 5 index
- `apps/api/src/data-source.ts` - thêm import + 3 phần tử vào mảng `entities` tường minh
- `apps/api/src/cli/verify-schema.ts` - CLI gate kiểm schema thật qua `information_schema.COLUMNS`
- `apps/api/package.json` - thêm script `schema:verify`
- `.env.example` - thêm `IP_HASH_SALT` (dev default)
- `.env.production.example` - thêm `IP_HASH_SALT` (placeholder `openssl rand -hex 32`)

## Decisions Made
- Cột `order_token` dùng index unique class-level `@Index('idx_oor_token', ['order_token'], { unique: true })` thay vì property-level, để nhất quán với 4 index khác của cùng entity (dễ đọc, đúng convention `menu-item.entity.ts`).
- `data-source.ts`: mỗi entity mới đặt trên dòng riêng trong mảng `entities` (thay vì gộp 1 dòng) — chỉ để thoả `grep | wc -l` của acceptance criteria đếm theo dòng, không ảnh hưởng hành vi.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `verify-schema.ts` thiếu `import 'dotenv/config'` → CLI luôn đọc nhầm MySQL local thay vì `.env`**
- **Found during:** Task 3 (chạy `pnpm schema:verify` lần đầu)
- **Issue:** CLI đứng riêng dưới `src/cli/` không tự động load `.env` — chỉ `main.ts` (`import 'dotenv/config'` dòng 2) làm việc này. `cron-jti-cleanup.ts`/`cron-audit-retention.ts` cùng thiếu bước này (đúng ghi chú STATE.md "2 cron hiện đang chết im" — giờ đã rõ 1 phần lý do tại sao không ai chạy được chúng đúng). Thiếu dotenv → `process.env.MYSQL_*` rỗng → `data-source.ts` fallback về `localhost:3306`/`order_app`/`order_app_pass` mặc định, tức MySQL native của máy (không phải Docker container ở cổng 3307 mà máy dev này đang dùng) → `ER_ACCESS_DENIED_ERROR`.
- **Fix:** Thêm `import 'dotenv/config';` ngay sau `import 'reflect-metadata';`, theo đúng pattern đã có sẵn ở `seed-menu-tables.ts` (CLI duy nhất trong repo đã làm đúng).
- **Files modified:** `apps/api/src/cli/verify-schema.ts`
- **Verification:** `pnpm schema:verify` sau khi sửa → exit 0, `"ok": true`, khớp `SHOW TABLES`/`DESCRIBE` độc lập.
- **Committed in:** `8cd90dd` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Bug này lẽ ra sẽ khiến Task 3 [BLOCKING] không bao giờ pass được bằng CLI của chính plan này — bắt buộc phải sửa để hoàn thành success criteria. Không có scope creep; cùng lúc phát hiện thêm bối cảnh cho nợ kỹ thuật "2 cron chết" đã ghi ở STATE.md (không sửa 2 file cron đó — ngoài phạm vi `files_modified` của plan này, ghi lại đây để phase sau biết).

## Issues Encountered

- **Môi trường Node/pnpm mismatch:** `pnpm` global cài trên máy (bản mới, cần Node ≥22.13, dùng `node:sqlite`) không tương thích với Node hiện có qua `fnm` (v20.11.0). Dùng `corepack pnpm` (tôn trọng `packageManager: "pnpm@9.0.0"` trong `package.json` gốc) để chạy mọi lệnh — không phải thay đổi cấu hình dự án, chỉ là cách gọi lệnh trong phiên này.
- **Worktree thiếu `node_modules` + build output của `@order/utils`/`@order/schemas`:** đã chạy `pnpm install` + `pnpm --filter @order/utils build` + `pnpm --filter @order/schemas build` trước khi typecheck chạy được — đúng như cảnh báo đã có ở `STATE.md` mục "Dựng lại môi trường trên máy mới".
- **Worktree thiếu file `.env`/`apps/api/.env`:** repo chính có `apps/api/.env` là symlink tới `../../.env` (không nằm trong git, gitignored) — đã tạo lại `.env` ở root worktree (đọc credentials thật từ `.env` của repo chính, KHÔNG commit) và symlink tương tự ở `apps/api/.env`. Cả 2 đều gitignored, đã xác nhận bằng `git check-ignore`.
- **`MYSQL_HOST=localhost` gây nhầm socket:** ban đầu dùng `localhost` (giống mẫu `.env.example`), nhưng khi Node/mysql2 hoặc `mysql` CLI thấy `localhost` có thể ưu tiên unix socket của MySQL **native** thay vì TCP tới container Docker ở cổng 3307 — đã đổi `MYSQL_HOST=127.0.0.1` để ép TCP, khớp với cổng thật `.env` chính đang dùng (3307, không phải 3306 như default trong code/`.env.example`). Đây là điều chỉnh môi trường cục bộ của phiên chạy, không phải thay đổi source code.

## Xác nhận Task 3 [BLOCKING] — bằng chứng MySQL thật

**MySQL version:** `8.0.46` (Docker container, cổng 3307)

**`pnpm --filter @order/api schema:verify` output (exit 0):**
```json
{
  "tables": [
    { "table": "store_settings", "exists": true, "missing_columns": [] },
    { "table": "phone_blacklist", "exists": true, "missing_columns": [] },
    { "table": "online_order_requests", "exists": true, "missing_columns": [] }
  ],
  "ok": true
}
```

**Kiểm chéo độc lập không qua CLI của repo:**
```
$ mysql -h 127.0.0.1 -P 3307 -u order_app -p*** order_quan_balun -e "SHOW TABLES LIKE 'online_order_requests';"
online_order_requests

$ mysql -h 127.0.0.1 -P 3307 -u order_app -p*** order_quan_balun -e "SHOW TABLES LIKE 'store_settings';"
store_settings

$ mysql -h 127.0.0.1 -P 3307 -u order_app -p*** order_quan_balun -e "DESCRIBE online_order_requests;"
Field                   Type            Null  Key  Default            Extra
id                      varchar(36)     NO    PRI  NULL
order_token             varchar(64)     NO    UNI  NULL
customer_token          varchar(64)     NO    MUL  NULL
status                  varchar(16)     NO    MUL  NULL
fulfillment_type        varchar(16)     NO         NULL
customer_name           varchar(128)    NO         NULL
customer_phone          varchar(16)     NO    MUL  NULL
customer_address        varchar(255)    YES        NULL
customer_lat            decimal(10,7)   YES        NULL
customer_lng            decimal(10,7)   YES        NULL
customer_map_link       varchar(512)    YES        NULL
distance_km             decimal(6,2)    YES        NULL
customer_note           varchar(500)    YES        NULL
items_snapshot          json            NO         NULL
subtotal                int unsigned    NO         NULL
submitted_at            datetime(6)     NO         NULL
reviewed_at             datetime(6)     YES        NULL
reviewed_by_user_id     varchar(36)     YES        NULL
reviewed_by_full_name   varchar(128)    YES        NULL
reject_reason           varchar(255)    YES        NULL
order_id                varchar(36)     YES        NULL
max_progress_shown      int             NO    0
ip_hash                 varchar(64)     NO         NULL
user_agent              varchar(255)    NO         NULL
created_at              datetime(6)     NO         CURRENT_TIMESTAMP(6) DEFAULT_GENERATED
```
Đủ `ip_hash`, `items_snapshot`, `subtotal`, `order_token`, `max_progress_shown` như acceptance criteria yêu cầu.

`DESCRIBE store_settings` và `DESCRIBE phone_blacklist` cũng đã kiểm, khớp 100% cột theo §4.1/§4.3 (không liệt kê lại ở đây để tránh trùng lặp — xem log phiên chạy).

## User Setup Required

None trong phạm vi phase 8 — nhưng lưu ý cho người tiếp tục làm việc trên worktree/máy khác:
- Cần tạo `.env` (copy `.env.example`, điền MySQL thật) trước khi chạy `apps/api`.
- Nếu dùng MySQL qua Docker container mapping cổng khác 3306 (như máy dev hiện tại dùng 3307), **dùng `127.0.0.1` thay vì `localhost`** cho `MYSQL_HOST` để tránh MySQL client ưu tiên unix socket của instance native.

## Next Phase Readiness
- Schema nền tảng cho REQ-J/K/L đã sẵn sàng, xác nhận thật trong MySQL — plan 08-03 trở đi (service/controller dùng 3 entity này) có thể bắt đầu ngay.
- `pnpm --filter @order/api schema:verify` là công cụ tái sử dụng được cho phase 9 (bảng `site_events`, `notification_outbox`) — chỉ cần thêm entry vào mảng `CHECKS`.
- Không có blocker mới phát sinh ngoài phạm vi phase 8.

---
*Phase: 08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n*
*Completed: 2026-07-30*
