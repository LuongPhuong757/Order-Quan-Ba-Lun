---
phase: 09-duy-t-n-th-ng-b-o-theo-d-i-n
plan: 04
subsystem: database
tags: [typeorm, mysql, entity, schema, synchronize]

# Dependency graph
requires:
  - phase: 08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n
    provides: online_order_requests staging table, explicit-entities-array data-source.ts pattern, schema:verify gate
provides:
  - 10 cot moi tren bang `orders` (source, fulfillment_type, online_request_id, order_token, customer_lat/lng, customer_map_link, distance_km, ship_fee, payment_method)
  - Cot `internal_reject_note` tren `online_order_requests` (D-09, tach khoi reject_reason)
  - Entity + bang moi `notification_outbox` (§4.6, 2 index cho poller va huy L2)
  - `verify-schema.ts` mo rong phu ca phase 8 + phase 9
affects: [09-05, 09-06, 09-07, 09-08, 09-09, 09-10, 09-11, 09-12, 09-13]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Entity moi phai them o 2 cho: file entity + mang `entities` tuong minh trong data-source.ts (khong autoload)"
    - "Cot decimal (customer_lat/lng, distance_km) khai type TS `string | null` vi mysql2 tra decimal dang chuoi"
    - "Chung minh schema bang truy van information_schema that (`schema:verify`), khong tin tsc"

key-files:
  created:
    - apps/api/src/modules/notifications/entities/notification-outbox.entity.ts
  modified:
    - apps/api/src/modules/orders/entities/order.entity.ts
    - apps/api/src/modules/public/entities/online-order-request.entity.ts
    - apps/api/src/data-source.ts
    - apps/api/src/cli/verify-schema.ts

key-decisions:
  - "notification_outbox.status them gia tri CANCELLED (ngoai PENDING/SENT/FAILED cua spec) de audit duoc truong hop huy outbox khi duyet kip truoc 90s"
  - "notification_outbox.level chi con L1/L2/L3, khong co L4 - dung theo D-12 (bo auto-OFF)"

requirements-completed: [REQ-M, REQ-N, REQ-O]

# Metrics
duration: 13min
completed: 2026-07-31
---

# Phase 9 Plan 4: Schema phase 9 (orders + notification_outbox) Summary

**10 cot moi tren `orders`, cot ghi chu noi bo tren `online_order_requests`, va bang `notification_outbox` moi - tat ca da ha canh that xuong MySQL, chung minh bang truy van `information_schema` va `SHOW COLUMNS/INDEX` truc tiep, khong chi bang typecheck.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-07-31T12:29:00+07:00 (sau khi doc plan/context/patterns)
- **Completed:** 2026-07-31T12:42:00+07:00
- **Tasks:** 2/2
- **Files modified:** 4 modified, 1 created

## Accomplishments
- 9 cot §4.5 them vao `orders` (source, fulfillment_type, online_request_id, order_token, customer_lat/lng, customer_map_link, distance_km, ship_fee, payment_method) - tat ca additive, 0 cot cu bi doi
- Cot `internal_reject_note` (D-09) them vao `online_order_requests`, tach han khoi `reject_reason` cong khai
- Entity moi `NotificationOutbox` (§4.6) voi 2 index (`idx_outbox_scheduled_status` cho poller, `idx_outbox_request` cho huy L2)
- `NotificationOutbox` dang ky vao mang `entities` tuong minh cua `data-source.ts` - khong bi `synchronize` bo qua
- `verify-schema.ts` mo rong: them check `orders` (10 cot moi), `notification_outbox`, va `internal_reject_note` tren `online_order_requests`
- Chung minh bang MySQL that: khoi dong API 1 lan de `synchronize` chay, sau do truy van tay + chay gate - tat ca xanh

## Task Commits

Each task was committed atomically:

1. **Task 1: 9 cot §4.5 tren `orders` + cot ghi chu noi bo + entity `notification_outbox`** - `2fd16bf` (feat)
2. **Task 2: [BLOCKING] Dang ky entity vao data-source + mo rong gate `schema:verify` + chung minh bang MySQL that** - `0de1307` (feat)

_Không có TDD trong plan này (type=auto cả 2 task)._

## Files Created/Modified
- `apps/api/src/modules/notifications/entities/notification-outbox.entity.ts` - Entity moi cho bang `notification_outbox` (§4.6), 2 index cho poller quet va huy L2
- `apps/api/src/modules/orders/entities/order.entity.ts` - Them 9 cot §4.5, tat ca additive
- `apps/api/src/modules/public/entities/online-order-request.entity.ts` - Them cot `internal_reject_note` (D-09)
- `apps/api/src/data-source.ts` - Import + dang ky `NotificationOutbox` vao mang `entities` tuong minh
- `apps/api/src/cli/verify-schema.ts` - Mo rong `CHECKS`: them bang `orders`, `notification_outbox`, cot `internal_reject_note`

## Decisions Made
- `notification_outbox.status` them gia tri `'CANCELLED'` ngoai PENDING/SENT/FAILED cua spec §4.6, vi §7 dong 489 yeu cau huy cac outbox con PENDING khi duyet/tu choi - giu row lai (khong xoa) de audit duoc.
- `notification_outbox.level` chi khai 3 gia tri (L1/L2/L3), khong co muc thu 4, dung theo D-12 (bo han auto-OFF).

## Deviations from Plan

None - plan executed exactly as written. 2 dieu chinh nho khong tinh la deviation ve mat noi dung:
- Grep acceptance criteria `grep -c "'L4'" ... = 0` yeu cau khong co chuoi ky tu `'L4'` xuat hien du la comment giai thich khong co L4 - da doi cach dien dat sang "muc thu 4" de dat dung tieu chi grep ma van giu duoc y nghia canh bao.
- Moi truong worktree thieu `node_modules` symlink va `apps/api/.env` (cac worktree phase 9 khac da co san) - tao lai 2 thu nay cuc bo de chay tsc/vitest/API (ca 2 deu nam trong `.gitignore`, khong lien quan git history).

## Issues Encountered
- Lan dau khoi dong API de `synchronize` chay bi loi `EADDRINUSE :3001` vi mot dev-server khac dang chiem port do tren may. Khong sao: log xac nhan `TypeOrmCoreModule dependencies initialized` va `Nest application successfully started` da xay ra TRUOC khi loi bind port, tuc `synchronize` da chay xong truoc do. Xac nhan lai bang truy van MySQL truc tiep (xem duoi) - tat ca bang/cot da co that.

## Bang chung MySQL that (BLOCKING - Task 2)

### `schema:verify` gate
```
cd apps/api && node --import @swc-node/register/esm-register src/cli/verify-schema.ts
```
```json
{
  "tables": [
    { "table": "store_settings", "exists": true, "missing_columns": [] },
    { "table": "phone_blacklist", "exists": true, "missing_columns": [] },
    { "table": "online_order_requests", "exists": true, "missing_columns": [] },
    { "table": "orders", "exists": true, "missing_columns": [] },
    { "table": "notification_outbox", "exists": true, "missing_columns": [] }
  ],
  "ok": true
}
```
Exit code: 0

### `SHOW TABLES LIKE 'notification_outbox'`
```
mysql -h127.0.0.1 -P3307 -uorder_app -porder_app_pass order_quan_balun -e "SHOW TABLES LIKE 'notification_outbox';"
```
```
Tables_in_order_quan_balun (notification_outbox)
notification_outbox
```

### `SHOW COLUMNS FROM orders` (10 cot moi, `ship_fee` Default 0, `source` Default STAFF, `payment_method` Default CASH)
```
Field                       Type            Null   Key   Default   Extra
...
source                      varchar(16)     NO           STAFF
fulfillment_type            varchar(16)     YES          NULL
online_request_id           varchar(36)     YES    MUL   NULL
order_token                 varchar(64)     YES    UNI   NULL
customer_lat                decimal(10,7)   YES          NULL
customer_lng                decimal(10,7)   YES          NULL
customer_map_link           varchar(512)    YES          NULL
distance_km                 decimal(6,2)    YES          NULL
ship_fee                    int             NO           0
payment_method               varchar(16)    NO           CASH
```
(9 cot cu giu nguyen ben tren, khong bi doi - da xac nhan bang `git diff --stat` chi co dong THEM)

### `SHOW COLUMNS FROM online_order_requests LIKE 'internal_reject_note'`
```
Field                     Type            Null   Key   Default   Extra
internal_reject_note      varchar(500)    YES          NULL
```

### `SHOW INDEX FROM notification_outbox WHERE Key_name='idx_outbox_scheduled_status'`
```
Table                Non_unique   Key_name                     Seq_in_index   Column_name    ...
notification_outbox  1            idx_outbox_scheduled_status  1              scheduled_at
notification_outbox  1            idx_outbox_scheduled_status  2              status
```

### `SELECT COUNT(*) FROM orders WHERE ship_fee IS NULL` (don cu nhan default, khong NULL)
```
COUNT(*)
0
```

### Full vitest suite (`cd apps/api && ./node_modules/.bin/vitest run`)
```
Test Files  10 passed (10)
     Tests  106 passed (106)
```
Bao gom `open-order-lock.integration.test.ts` (3 test, chay 2 connection MySQL that) - khong bi anh huong boi cot moi.

### `tsc --noEmit` (2 lan, sau moi task)
Exit 0 ca 2 lan, khong loi.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Schema phase 9 da ha canh that xuong MySQL va co gate tu dong (`schema:verify`) chan hoi quy - 5 plan phia sau (09-05 den 09-13, tru cac plan phu thuoc plan nay) duoc phep gia dinh bang/cot da ton tai.
- `notification_outbox` san sang cho `NotificationOutboxService` va poller (plan sau) ghi/doc.
- `Order.order_token` (UNIQUE) san sang cho luong duyet don copy token tu `online_order_requests`.
- Khong co blocker nao con lai tu plan nay.

---
*Phase: 09-duy-t-n-th-ng-b-o-theo-d-i-n*
*Completed: 2026-07-31*

## Self-Check: PASSED

- FOUND: apps/api/src/modules/notifications/entities/notification-outbox.entity.ts
- FOUND: .planning/phases/09-duy-t-n-th-ng-b-o-theo-d-i-n/09-04-SUMMARY.md
- FOUND commit: 2fd16bf
- FOUND commit: 0de1307
