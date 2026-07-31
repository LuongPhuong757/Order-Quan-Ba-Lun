# Phase 9: Duyệt đơn, Thông báo & Theo dõi đơn - Pattern Map

**Mapped:** 2026-07-31
**Files analyzed:** 41 (new + modified, backend + admin FE + shop FE)
**Analogs found:** 39 / 41 exact/role-match — 2 genuinely new-in-repo patterns (SSE controller, `@nestjs/schedule` cron wiring), flagged below with the closest partial analog + official-doc pattern from RESEARCH.md.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `apps/api/src/modules/admin-online-orders/admin-online-orders.module.ts` | config (Nest module) | — | `apps/api/src/modules/orders/orders.module.ts` | exact |
| `apps/api/src/modules/admin-online-orders/admin-online-orders.controller.ts` | controller | request-response + streaming (SSE) | `apps/api/src/modules/tables/tables.controller.ts` (REST part) + `audit.interceptor.ts` (event part) | role-match (composite) |
| `apps/api/src/modules/admin-online-orders/admin-online-orders.service.ts` | service | CRUD + row-lock transaction | `apps/api/src/modules/orders/orders.service.ts` (`getOrCreateOpenOrderImpl` + `runWithRetry`) | exact |
| `apps/api/src/modules/admin-online-orders/table-assign.ts` | utility (pure fn) | transform | `apps/api/src/modules/public/store-status.ts` (pure-fn module shape) + `tables.controller.ts` `KIND_FORMAT` (data) | role-match |
| `apps/api/src/modules/admin-online-orders/admin-online-orders.integration.test.ts` | test | 2-connection race | `apps/api/src/modules/public/open-order-lock.integration.test.ts` | exact |
| `apps/api/src/modules/notifications/entities/notification-outbox.entity.ts` | model | — | `apps/api/src/modules/public/entities/online-order-request.entity.ts` | exact |
| `apps/api/src/modules/notifications/notification-outbox.service.ts` | service | CRUD (insert L1-L3, cancel L2) | `apps/api/src/modules/public/public-orders.service.ts` (`makeDeps`/insert pattern) | role-match |
| `apps/api/src/modules/notifications/outbox-poller.ts` | service | batch (cron scan+dispatch) | none in-repo — `@Cron` is genuinely new; use RESEARCH.md Pattern 3 (official NestJS docs) | **no analog** |
| `apps/api/src/modules/notifications/channels/sms-channel.ts` | service | event-driven dispatch | none in-repo (no SMS sending exists yet) — interface + 2 impl pattern only in RESEARCH.md/spec | **no analog** |
| `apps/api/src/modules/notifications/channels/email-channel.ts` | service | event-driven dispatch | same as above | **no analog** |
| `apps/api/src/modules/notifications/cron-audit-retention.cron.ts` | service (DI wrapper) | batch | `apps/api/src/cli/cron-audit-retention.ts` (query logic to copy, NOT the bootstrap pattern) | role-match |
| `apps/api/src/modules/notifications/cron-jti-cleanup.cron.ts` | service (DI wrapper) | batch | `apps/api/src/cli/cron-jti-cleanup.ts` (query logic to copy) | role-match |
| `apps/api/src/modules/notifications/notifications.module.ts` | config (Nest module) | — | `apps/api/src/modules/orders/orders.module.ts` | exact |
| `apps/api/src/data-source.ts` | config | — | itself (MODIFY — add `Order`'s new cols are inline, add `NotificationOutbox` to `entities: [...]` array) | n/a (touch point, not analog) |
| `apps/api/src/app.module.ts` | config | — | itself (MODIFY — add `ScheduleModule.forRoot()`, `AdminOnlineOrdersModule`, `NotificationsModule` to `imports`) | n/a |
| `apps/api/src/modules/orders/entities/order.entity.ts` | model | — | itself (MODIFY — add 9 columns §4.5) | n/a |
| `apps/api/src/modules/public/entities/online-order-request.entity.ts` | model | — | itself (MODIFY — add internal-note column for D-09; most other needed columns already exist: `reject_reason`, `reviewed_by_*`, `order_id`, `max_progress_shown`) | n/a |
| `apps/api/src/modules/orders/orders.service.ts` | service | CRUD (row lock) | itself (MODIFY — decide export-vs-copy of `runWithRetry`, see Pitfall 2) | n/a |
| `apps/api/src/modules/public/order-guard.ts` | utility (pure fn) | transform | itself (MODIFY — remove `ordering.enabled` branch per D-11) | n/a |
| `apps/api/src/modules/public/order-guard.test.ts` | test | unit | itself (MODIFY — remove/replace MANUAL_OFF/OUTSIDE_HOURS cases) | n/a |
| `apps/api/src/modules/public/submit-order.ts` | utility (orchestrator) | request-response | itself (MODIFY — `buildGuardMessage` lines 89/93 cases become dead if guard never returns those codes) | n/a |
| `apps/api/src/modules/public/store-status.ts` | utility (pure fn) | transform | itself (**mechanism unchanged** — D-11 only changes how `apps/shop` interprets `enabled===false`; no code edit expected here except maybe a comment update) | n/a |
| `apps/api/src/modules/public/public-orders.service.ts` | service | request-response | itself (MODIFY — extend `getByToken()` with `computeProgress()` call + persist `max_progress_shown`) | n/a |
| `apps/api/src/modules/public/order-progress.ts` | utility (pure fn) | transform | `apps/api/src/modules/public/store-status.ts` (pure-fn module shape: no Nest/TypeORM imports, `nowMs` always a param) | exact (shape) |
| `apps/api/src/modules/public/order-progress.test.ts` | test | unit | `apps/api/src/modules/public/order-guard.test.ts` (table-of-cases unit test style) | exact |
| `apps/api/src/modules/public/public-store.controller.ts` | controller | request-response | itself (MODIFY — add `closed_banner_text` to whitelist + `.strict().parse()`) | n/a |
| `packages/schemas/src/public-store.ts` | schema | — | itself (MODIFY — add `closed_banner_text: z.string()`) | n/a |
| `packages/schemas/src/public-orders.ts` | schema | — | itself (MODIFY — extend `PublicOrderStatus` per §6 whitelist) | n/a |
| `apps/api/src/modules/settings/settings.defaults.ts` | config | — | itself (MODIFY — add `closed_banner_text`/`closed_submit_confirm_text` kind:'string'; resolve `escalate_autooff_after_s` per D-12 discretion) | n/a |
| `apps/api/src/modules/settings/settings.controller.ts` | controller | request-response | itself (MODIFY — add 2 keys to `UpdateSettingsDto` + patch loop) | n/a |
| `.env.example` | config | — | (grep existing file for pattern) | n/a |
| `apps/web/src/pages/OnlineOrdersQueuePage.tsx` | component (page) | request-response + SSE consumer | `apps/web/src/pages/MenuManagementPage.tsx` (card list, filter row, hardcode-hex convention) + `apps/web/src/components/NotificationBell.tsx` (badge/modal styling) | role-match (composite) |
| `apps/web/src/lib/bell-unlock.ts` | utility | event (audio unlock) | none in-repo — RESEARCH.md Pattern 4 (Chrome/MDN docs) is the source | **no analog** |
| `apps/web/src/App.tsx` | routing/config | — | itself (MODIFY — add `<Route element={<RoleGate allow={['admin','order','kitchen']}/>}>` block, exact copy of `/orders` block) | exact |
| `apps/web/src/pages/AdminSettingsPage.tsx` | component (page) | request-response | itself (MODIFY — add 2 textarea fields inside existing "Công tắc nhận đơn" `.card`, copy `off-reason` textarea+counter pattern) | exact (self-analog) |
| `apps/shop/src/pages/OrderTrackPage.tsx` | component (page) | request-response (poll) | itself (MODIFY — insert stepper/percent/banners at the marked comment) | n/a |
| `apps/shop/src/pages/CheckoutPage.tsx` | component (page) | request-response | itself (MODIFY — banner tone/copy, remove `storeOff` from `ctaDisabled`) | n/a |
| `apps/shop/src/components/BannerNotice.tsx` | component | — | itself (MODIFY — add `'info'` to `Tone` union + `TONE_STYLES`) | n/a |

## Pattern Assignments

### `apps/api/src/modules/admin-online-orders/admin-online-orders.service.ts` (service, row-lock transaction)

**Analog:** `apps/api/src/modules/orders/orders.service.ts` lines 183-288

**Retry wrapper to copy or export** (lines 187-204):
```typescript
/** Retry helper — chạy lại 1-2 lần khi gặp transient DB error (deadlock, lock
 * timeout). Sleep ngắn ngẫu nhiên giữa các lần để giảm collision. */
private async runWithRetry<T>(fn: () => Promise<T>, maxAttempts: number): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = (err as Error).message || '';
      const isTransient = /deadlock|lock wait timeout|ER_LOCK/i.test(msg);
      if (!isTransient || attempt === maxAttempts) throw err;
      this.logger.warn(`Transient DB error (attempt ${attempt}/${maxAttempts}): ${msg} — retry`);
      await new Promise((r) => setTimeout(r, 30 + Math.random() * 70));
    }
  }
  throw lastErr;
}
```
⚠ **This method is `private` on `OrdersService`** (confirmed by direct read). It is NOT importable as-is. Planner must pick explicitly: (a) copy these 18 lines into the new service, or (b) refactor `OrdersService` to export a standalone `runWithRetry()` function both services import. Do not assume it "already works from outside."

**Transaction + lock pattern to copy the SHAPE of** (lines 229-267, fast-path/slow-path with `pessimistic_write`):
```typescript
const { order: resultOrder, created } = await this.ds.transaction(async (mgr) => {
  const orderRepo = mgr.getRepository(Order);
  const lockedExisting = await orderRepo
    .createQueryBuilder('o')
    .where('o.table_id = :tid AND o.closed_at IS NULL', { tid: table_id })
    .orderBy('o.opened_at', 'ASC')
    .setLock('pessimistic_write')
    .getMany();
  // ... dedupe / create ...
});
```
Phase 9's `confirm()` needs the **query-form** `FOR UPDATE` (not `setLock()`) because it selects candidate free tables by `kind` + `code ASC LIMIT 1` — mirror the raw-SQL `FOR UPDATE` style used in `public-orders.service.ts` (`hasOpenOrderForPhoneLocked`) instead, since that is a `SELECT ... ORDER BY ... LIMIT 1 FOR UPDATE` shape, closer to what table-assignment needs than TypeORM's `setLock()` query builder.

**Call site / composition pattern** (line 183-185):
```typescript
async getOrCreateOpenOrder(table_id: string, creator?: OrderCreator): Promise<Order> {
  return this.runWithRetry(() => this.getOrCreateOpenOrderImpl(table_id, creator), 2);
}
```
Mirror this shape: `confirm(id, actor) { return this.runWithRetry(() => this.confirmImpl(id, actor), 2); }`.

**Error handling pattern** (lines 279-287): re-throw known `HttpException` subclasses unchanged, log + rethrow everything else. Copy verbatim.

---

### `apps/api/src/modules/admin-online-orders/table-assign.ts` (utility, pure fn)

**Analog for module shape:** `apps/api/src/modules/public/store-status.ts` (no Nest/TypeORM imports, deterministic pure functions, header docblock explaining why it's pure).

**Analog for the actual naming data — `KIND_FORMAT`** (`apps/api/src/modules/tables/tables.controller.ts` lines 52-61):
```typescript
/** Mapping kind → format code + name.
 * - dine-in   → ban-01, ban-02, ... | "Bàn 01", "Bàn 02"
 * - takeaway  → mang-ve-01, ... | "Mang về 01", ...
 * - delivery  → ship-01, ... | "Ship 01", ...
 */
const KIND_FORMAT: Record<string, { codePrefix: string; namePrefix: string }> = {
  'dine-in':  { codePrefix: 'ban',     namePrefix: 'Bàn' },
  'takeaway': { codePrefix: 'mang-ve', namePrefix: 'Mang về' },
  'delivery': { codePrefix: 'ship',    namePrefix: 'Ship' },
};
```
⚠ **This is `private const` module-scope in `tables.controller.ts`, not exported.** Phase 9 must either (a) export `KIND_FORMAT` from `tables.controller.ts` (small risk, controller file) or (b) move it to a shared location (e.g. `restaurant-table.entity.ts` or a new `table-kind.ts`) and import it from both `tables.controller.ts` and the new `table-assign.ts` — planner must choose and note it, do NOT hardcode a second copy of `'ship'`/`'mang-ve'` strings (drift risk). `fulfillment_type` → `kind` map per RESEARCH: `PICKUP → 'takeaway'`, `DELIVERY → 'delivery'`.

**Do NOT use** `'SHIP-'`/`'TAKE-'` (uppercase) — that is stale prose from the spec, not the real convention (Pitfall 3 in RESEARCH.md, confirmed by direct read above).

---

### `apps/api/src/modules/admin-online-orders/admin-online-orders.integration.test.ts` (test, 2-connection race)

**Analog:** `apps/api/src/modules/public/open-order-lock.integration.test.ts` (full file read, 223 lines) — copy this file's structure almost verbatim:

**Setup/teardown to copy verbatim** (lines 1-79):
```typescript
import 'dotenv/config';  // MANDATORY — data-source.ts reads process.env.MYSQL_PORT raw
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../../data-source.js';

let ds: DataSource;
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeAll(async () => {
  ds = new DataSource({ ...dataSourceOptions, synchronize: false });
  try {
    await ds.initialize();
  } catch (err) {
    throw new Error(
      'Không kết nối được MySQL local — hãy bật MySQL trước khi chạy test này ' +
        `... Lỗi gốc: ${String(err)}`,
    );
  }
}, 20_000);

afterAll(async () => {
  await cleanupSentinelRows();
  await ds.destroy();
}, 20_000);

beforeEach(async () => {
  await cleanupSentinelRows();
});
```

**Race pattern to copy verbatim** (lines 121-153, `Promise.race` with a 500ms timer to *prove* a query is blocked, not just slow):
```typescript
let bResolved = false;
const bPromise: Promise<Array<{ id: string }>> = runnerB
  .query(`SELECT ... FOR UPDATE`, [param])
  .then((rows) => { bResolved = true; return rows; });

const raceResult = await Promise.race([bPromise, sleep(500).then(() => 'TIMEOUT' as const)]);
expect(raceResult).toBe('TIMEOUT');
expect(bResolved).toBe(false);

await runnerA.commitTransaction();
const bRows = await bPromise;
expect(bRows.length).toBe(1);
await runnerB.commitTransaction();
```
Phase 9 needs this pattern **twice**: (1) table-allocation race — 2 `QueryRunner`s racing the `FOR UPDATE` on `restaurant_tables` for the same `kind`; (2) revenue-isolation count — insert N `WAITING` requests, assert `orders`/revenue query count is unaffected (simpler, no race needed, just before/after count — see `rate limit` `describe` block at lines 203-223 for the "insert N rows, assert COUNT" style without racing).

**Cleanup-by-sentinel pattern** (lines 21-25, 33-35): use a fixed sentinel phone/prefix (e.g. `0900000001`), `DELETE ... WHERE customer_phone LIKE '09000000%'` in both `beforeEach` and `afterAll`. Copy this convention for whatever sentinel table `code`/phone phase 9 test uses.

---

### `apps/api/src/modules/admin-online-orders/admin-online-orders.controller.ts` (controller, SSE + REST)

**REST part analog:** `apps/api/src/modules/tables/tables.controller.ts` — guard/DTO conventions:
```typescript
@Controller('admin/online-orders')   // NO /api prefix — OD-08 convention, confirmed at
                                      // settings.controller.ts:1-5 and tables.controller.ts
@UseGuards(JwtAuthGuard)              // class-level auth
export class AdminOnlineOrdersController {
  @Get()
  @UseGuards(RequireRoles('admin', 'order', 'kitchen'))   // method-level role gate, D-02
  async list(@Query('status') status: string) { ... }

  @Post(':id/confirm')
  @UseGuards(RequireRoles('admin', 'order', 'kitchen'))
  async confirm(@Param('id') id: string, @Req() req: Request) { ... }
}
```

**`RequireRoles` guard — exact source, currently UNUSED elsewhere in repo** (`apps/api/src/modules/auth/guards/roles.guard.ts`, full file):
```typescript
export function RequireRoles(...allowed: string[]): Type<CanActivate> {
  @Injectable()
  class RolesGuardMixin implements CanActivate {
    canActivate(ctx: ExecutionContext): boolean {
      const req = ctx.switchToHttp().getRequest<Request>();
      const role = req.user?.role ?? (req.user?.is_owner ? 'admin' : null);
      if (!role || !allowed.includes(role)) {
        throw new ForbiddenException({ code: 'ROLE_FORBIDDEN', message: 'Bạn không có quyền xem mục này.' });
      }
      return true;
    }
  }
  return mixin(RolesGuardMixin);
}
```
This is the EXACT mechanism for D-02 ("cả 3 role admin/order/kitchen đều duyệt được"). It exists, compiles, is fully generic — just apply `@UseGuards(RequireRoles('admin', 'order', 'kitchen'))` at method level under a class-level `@UseGuards(JwtAuthGuard)`. `ROLE_VALUES = ['admin','order','kitchen'] as const` lives at `apps/api/src/modules/admin/users.controller.ts:26` if a typed constant is wanted instead of string literals.

**SSE part — NO exact analog in repo (flagged `no analog` above).** Use RESEARCH.md Pattern 1 verbatim (official NestJS `@Sse()` + `fromEvent(EventEmitter2)` + `merge` + `takeUntil(close$)` + 15s heartbeat) — already fully worked out in `09-RESEARCH.md` lines 173-198, cite that as the source, not a repo file.

**Emitter usage analog (the "emit" side) — `apps/api/src/modules/audit/audit.interceptor.ts` line 108**:
```typescript
this.emitter.emit('audit.write', ev);   // non-blocking, fire-and-forget
```
and the consume side (lines 114-128):
```typescript
@Injectable()
export class AuditEventHandler {
  constructor(private readonly svc: AuditService) {}
  @OnEvent('audit.write', { async: true })
  async handle(ev: AuditEvent): Promise<void> {
    try {
      await this.svc.write(ev);
    } catch (err) {
      console.error('audit.write failed', err);   // swallow — must not crash app
    }
  }
}
```
`EventEmitterModule.forRoot()` is already registered at `app.module.ts:24` — no new module registration needed for the emitter itself, only for the new feature modules.

---

### `apps/api/src/modules/notifications/entities/notification-outbox.entity.ts` (model, new)

**Analog:** `apps/api/src/modules/public/entities/online-order-request.entity.ts` (full file read, 124 lines) — copy the entity-declaration conventions:
```typescript
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';

@Entity('notification_outbox')
@Index('idx_outbox_scheduled_status', ['scheduled_at', 'status'])  // for poller scan
export class NotificationOutbox {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  request_id!: string;

  @Column({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  scheduled_at!: number;

  @Column({ type: 'datetime', precision: 6, nullable: true, transformer: dateToMsTransformer })
  sent_at!: number | null;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;
}
```
Use `dateToMsTransformer` for every `datetime` column (project-wide convention: DB is UTC datetime, TS type is epoch-ms number) — do not invent a different date-handling approach.

**⚠ MANDATORY touch point — `apps/api/src/data-source.ts`** (full file read, 59 lines): entities are an **explicit array, not autoloaded** (`synchronize: true`, comment at lines 40-43 confirms: "entity thiếu ở đây thì `synchronize` bỏ qua hoàn toàn bảng của nó mà `tsc` vẫn xanh"). Both `Order` (already imported) and the new `NotificationOutbox` MUST be added to the `entities: [...]` array (line 44-50) or the table silently never gets created:
```typescript
entities: [
  User, AuditLog, RevokedJti, RecoveryCode, MenuItem, MenuGroup, RestaurantTable, Order,
  OrderItem, OrderActivityLog,
  StoreSetting,
  PhoneBlacklist,
  OnlineOrderRequest,
  NotificationOutbox,   // ADD
],
```

---

### `apps/api/src/modules/orders/entities/order.entity.ts` (model, MODIFY)

**Analog:** itself, existing 73-line file (full file read) — additive-only columns following the exact same `@Column` style already used (e.g. `customer_name`/`customer_address`/`customer_phone` nullable varchar pattern at lines 44-51):
```typescript
@Column({ type: 'varchar', length: 16, default: 'STAFF' })
source!: string;   // 'STAFF' | 'ONLINE'

@Column({ type: 'varchar', length: 16, nullable: true })
fulfillment_type!: string | null;   // 'PICKUP' | 'DELIVERY' | null (dine-in)

@Column({ type: 'varchar', length: 36, nullable: true })
@Index()
online_request_id!: string | null;

@Column({ type: 'varchar', length: 64, nullable: true })
@Index({ unique: true })
order_token!: string | null;
// + customer_lat/lng/map_link, distance_km, ship_fee DEFAULT 0, payment_method DEFAULT 'CASH'
```
Additive columns are safe under `synchronize: true` (no migration system, confirmed at `data-source.ts:51-54`) — but **never rename** an existing column (would silently drop data, per the Anti-Pattern warning already in RESEARCH.md and the entity's own docblock in `online-order-request.entity.ts:16-17`).

---

### `apps/api/src/modules/public/order-progress.ts` (utility, new pure fn)

**Analog for module shape:** `apps/api/src/modules/public/store-status.ts` (full file read, 122 lines) — the exact "pure function module" convention to follow:
```typescript
// Module thuần: không import gì từ @nestjs/* hay typeorm.
// nowMs LUÔN là tham số — KHÔNG tự đọc giờ hệ thống bên trong (để test được, không cần fake timer).
export function computeProgress(order: {...}, nowMs: number): { stage: Stage; percent: number; ... } {
  // ...
}
```
Persisting the monotonic `max_progress_shown` mirrors how `store-status.ts` documents its own "tính lúc đọc, không ghi lại DB" tradeoff — but `order-progress.ts`'s caller (`public-orders.service.ts`) DOES need to persist `max(percent, old)`, unlike `store-status.ts`. Don't copy the "never write" part, only the "pure fn, `nowMs` as param" shape.

**Test analog:** `apps/api/src/modules/public/order-guard.test.ts` (full file, 94 lines) — table-of-cases style with a `baseInput()` builder + `describe` per priority tier. Use the same style for `order-progress.test.ts` (one `describe` per `stage`, one for monotonic clamp, one for the 95% ceiling).

---

### `apps/api/src/modules/public/order-guard.ts` + `submit-order.ts` (MODIFY, remove blocking per D-11)

**Exact current blocking branch to remove** (`order-guard.ts` lines 26-31, full file read):
```typescript
export function checkOrderGuard(input: OrderGuardInput): GuardErrorCode | null {
  if (!input.ordering.enabled) {
    return input.ordering.blocking_reason === 'OUTSIDE_HOURS'
      ? 'STORE_CLOSED'
      : 'ONLINE_ORDERING_DISABLED';
  }
  // ... this whole branch must go away; `ordering` may even be droppable from OrderGuardInput
  // entirely if nothing else needs it — check callers before removing the field.
}
```

**Exact 2 dead cases after the branch is removed** (`submit-order.ts`, `buildGuardMessage()`, lines 88-94):
```typescript
switch (code) {
  case 'ONLINE_ORDERING_DISABLED':
    return settings.online_ordering_off_reason
      ? `Quán vừa tắt nhận đơn online. ${settings.online_ordering_off_reason}`
      : `Quán vừa tắt nhận đơn online. Vui lòng gọi ${settings.store_phone} để đặt trực tiếp.`;
  case 'STORE_CLOSED':
    return `Quán đang ngoài giờ mở cửa hôm nay. Gọi ${settings.store_phone} nếu cần hỗ trợ.`;
  // ... these 2 cases + their GuardErrorCode union members become unreachable — remove both
  // the switch cases AND the union members in the same edit (TypeScript will flag unused
  // union members left dangling as a code smell, not a compile error, so this must be
  // caught by review, not tsc).
}
```
**`4 anti-abuse layers that MUST survive untouched (D-18)`** — confirmed still present and independent of the removed branch: `isBlacklisted` (line 32), `isRateLimited` (line 33), `hasOpenOrder` (line 34), `unavailableItemCodes` (line 35) in `order-guard.ts`, all fed from `submit-order.ts` lines 132-141 (blacklist/rate-limit/menu lookups) which do not touch `ordering` at all — safe to leave those Promise.all fetches exactly as-is.

**`order-guard.test.ts`** (full file read, 94 lines): the `MANUAL_OFF`/`OUTSIDE_HOURS` `describe` blocks (lines 34-49) test exactly the branch being removed — delete those 2 `describe` blocks, keep every other `describe` (blacklist/rate-limit/open-order/unavailable), and if `ordering` field is dropped from `OrderGuardInput`, `baseInput()` (lines 17-26) needs its `ordering: ENABLED` default removed too.

---

### `apps/api/src/modules/public/public-store.controller.ts` + `packages/schemas/src/public-store.ts` (MODIFY, add D-14 banner text)

**Exact whitelist pattern to extend** (`public-store.controller.ts`, full file, 53 lines):
```typescript
const payload: PublicStoreStatus = {
  ordering_enabled: status.enabled,
  off_reason: settings.online_ordering_off_reason,
  store_phone: settings.store_phone,
  // ... ADD: closed_banner_text: settings.closed_banner_text,
  ...
};
return apiOk(PublicStoreStatus.strict().parse(payload));  // .strict() will THROW if a field
                                                            // is added to payload but not to
                                                            // the zod schema below — this is
                                                            // the safety net, not optional
```
`packages/schemas/src/public-store.ts` (full file, 38 lines) must add `closed_banner_text: z.string()` to the `PublicStoreStatus` zod object, or `.strict().parse()` throws at runtime the moment the controller adds the field — schema-first order of edits matters here (add to schema BEFORE controller, or the dev loop hits a 500 immediately).

**`closed_submit_confirm_text` does NOT belong on this endpoint** — it's consumed after submit, i.e. inside `PublicOrderStatus`/the submit-response path, not `/api/public/store`. Do not add both strings to the same schema; keep them where each is actually read (per UI-SPEC's explicit "đúng 2 key" callout).

---

### `apps/api/src/modules/settings/settings.defaults.ts` + `settings.controller.ts` (MODIFY, D-14 config keys + D-12 discretion)

**Exact array entry pattern to copy** (`settings.defaults.ts` lines 17-43, full file read):
```typescript
export const SETTINGS_DEFAULTS: readonly SettingDefault[] = [
  // ...
  { key: 'closed_banner_text', kind: 'string', default: 'Hiện chúng tôi đang đóng cửa, đơn của quý khách cứ tiếp tục đặt và chúng tôi sẽ xử lý sớm nhất có thể' },
  { key: 'closed_submit_confirm_text', kind: 'string', default: 'Chúng tôi đã tiếp nhận đơn, và sẽ liên hệ khi quán mở lại' },
] as const;
```
**Must also update `StoreSettingsMap` type** (lines 47-68) with the 2 new fields — `SETTINGS_DEFAULTS_MAP`/`SETTINGS_KIND_BY_KEY` are auto-derived from the array (lines 70-76), no separate edit needed there.

**Silent-drop pitfall (confirmed live in code, `settings.service.ts` line 71 and `settings.controller.ts` lines 118-131):** `updateMany()`'s loop does `if (!kind) continue` — any key patched from the FE that isn't in `SETTINGS_DEFAULTS` is silently ignored, 200 OK, nothing written. The 2 new keys must be added to `settings.defaults.ts` AND to the `for (const key of [...])` allowlist in `settings.controller.ts` `update()` (lines 118-130) or the admin's save button will silently no-op.

**D-12 discretion resolved by direct read:** `AdminSettingsPage.tsx` grep found **no** rendering of `escalate_autooff_after_s` anywhere in the file (confirmed via targeted grep across the whole 722-line file) — RESEARCH.md's Open Question #1 is answered: safe to delete the key entirely from `SETTINGS_DEFAULTS`/`StoreSettingsMap` with no FE fallout. If `AdminSettingsPage.tsx` is modified concurrently by the user's uncommitted edit (see constraint below), re-grep before finalizing.

---

### `apps/web/src/pages/AdminSettingsPage.tsx` (MODIFY, add 2 textarea fields — D-14)

**Exact analog: the file's own existing `off-reason` textarea** (lines 297-371, read directly):
```tsx
<div>
  <label htmlFor="off-reason">Lý do hiện cho khách</label>
  <textarea
    id="off-reason"
    value={offReason}
    onChange={(e) => setOffReason(e.target.value.slice(0, 255))}
    maxLength={255}
    rows={3}
    placeholder="vd: Hết nguyên liệu, quán mở lại lúc 17h"
    style={{ width: '100%', fontFamily: 'inherit', padding: '10px 12px', borderRadius: 8, border: '1px solid #d1d5db' }}
  />
  <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 0' }}>
    {255 - offReason.length} ký tự còn lại
  </p>
</div>
```
⚠ **UI-SPEC D-14 says the 2 new strings must be unlimited length, NOT capped at 255** (layout must co-giãn, no `maxLength`, no `.slice()`, no char counter implying a cap) — copy the `<textarea>` container/label/save-button conventions from this block but **drop `maxLength={255}` and the "ký tự còn lại" counter** for these 2 new fields specifically. Place them in the same `.card` block titled "Công tắc nhận đơn" (lines 300-371), which is the exact card CONTEXT.md D-14 says to reuse (`cạnh ô lý do tạm ngưng đã tồn tại`).

**Save/toast pattern** (line 288, same file): `toast.push('success', 'Đã lưu thông tin giao hàng ✓'); await onRefresh();` — reuse this exact call shape for the new save action.

⚠ **Constraint reminder:** `MenuManagementPage.tsx` has an uncommitted 5MB→10MB edit — irrelevant to this page, but confirms the user is actively editing `apps/web/src/pages/*` right now; re-diff `AdminSettingsPage.tsx` before executor writes to it.

---

### `apps/web/src/App.tsx` (MODIFY, add route — D-02)

**Exact block to copy (already has the right 3-role shape)** (lines 38-41):
```tsx
{/* Order: admin + order + kitchen (bếp cần xem để biết món nào của bàn nào) */}
<Route element={<RoleGate allow={['admin', 'order', 'kitchen']} />}>
  <Route path="/orders" element={<OrdersPage />} />
</Route>
```
New block: `<Route element={<RoleGate allow={['admin', 'order', 'kitchen']} />}><Route path="/admin/online-orders" element={<OnlineOrdersQueuePage />} /></Route>`. `RoleGate` (lines 182-199) is a local function in this same file, not a separate module — import nothing extra, just add the new `<Route>` inside the existing `<Route element={<ProtectedShell />}>` tree. Also add a nav-bottom entry per role if the queue page should be reachable from bottom nav (lines 142-169 show the exact per-role `<nav>` blocks) — CONTEXT.md doesn't mandate this, treat as discretion.

---

### `apps/web/src/pages/OnlineOrdersQueuePage.tsx` (NEW component)

**Card-list + hardcoded-hex convention analog:** `apps/web/src/pages/MenuManagementPage.tsx` (grepped for `className="card"`/`.secondary`/`.danger` — confirmed pattern: `<div className="card" style={{...}}>` per row, `<button className="secondary">`/`<button className="danger">` for non-default actions, no CSS-in-JS library, inline `style={{}}` for one-offs).

**Badge convention analog:** `apps/web/src/components/NotificationBell.tsx` lines 57-78 (unread badge):
```tsx
{unread > 0 && (
  <span style={{
    position: 'absolute', top: 0, right: 0,
    background: '#dc2626', color: 'white', borderRadius: 999,
    fontSize: 11, fontWeight: 700, minWidth: 18, height: 18,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px',
  }}>
    {unread > 99 ? '99+' : unread}
  </span>
)}
```
Reuse this exact shape for the "(N)" badge next to `<h1>Hàng chờ duyệt</h1>`.

**Per-second waiting clock — do NOT reuse `apps/web/src/lib/item-age.ts` as-is.** Full file read (28 lines): `ageColor()`/`ageMinutes()`/`isAgeCritical()` are hardcoded to fixed 10min/20min thresholds (`AGE_WARN_MS`, `AGE_CRITICAL_MS`) baked into the module, tied to kitchen-item semantics. Phase 9's threshold is `escalate_sms_after_s` (default 90s, **configurable via settings, not a constant**). The *shape* (compute `Date.now() - created_at`, return a color) is reusable, but the actual functions are not parameterized for a runtime-configurable threshold — write a new small helper or parameterize a copy, don't import `item-age.ts` directly for this different semantic threshold.

**`useToast` — exact import path:** `apps/web/src/components/Toast.tsx` (full file, 68 lines) exports `useToast()`; call shape `toast.push('success', 'Đã xác nhận — bàn {code}')` matches `ToastKind = 'success'|'error'|'info'|'ready'` already defined there (line 3) — no change needed to `Toast.tsx` itself.

**`RoleGate` wrapping:** see App.tsx section above — `<RoleGate allow={['admin','order','kitchen']}/>` wraps the route, not the page component itself (page assumes it's already authorized).

---

### `apps/shop/src/components/BannerNotice.tsx` (MODIFY, add `'info'` tone)

**Exact union + map to extend** (full file read, 166 lines, lines 17, 26-30):
```typescript
type Tone = 'brand' | 'warn' | 'danger';   // → add 'info'

const TONE_STYLES: Record<Tone, { bg: string; text: string }> = {
  brand: { bg: 'var(--brand-100)', text: 'var(--text-strong)' },
  warn: { bg: 'var(--warn-100)', text: 'var(--warn-600)' },
  danger: { bg: 'var(--danger-100)', text: 'var(--danger-600)' },
  // ADD: info: { bg: 'var(--info-100)', text: 'var(--info-600)' },
};
```
`renderIcon()` (lines 73-77) needs a 4th branch (`if (tone === 'info') return <InfoGlyph />` — note `InfoGlyph` **already exists** in this file, lines 79-86, currently unused by any tone! It was pre-built but never wired — confirms `tokens.css`'s `--info-*` tokens were anticipated). The 2-branch `role="alert"`/`role="status"` split (lines 59-70) — `'info'` should render `role="status"` (non-danger branch), no new branch needed there.

---

### `apps/shop/src/pages/CheckoutPage.tsx` (MODIFY, D-11 unblock + banner change)

**Exact line to change — remove blocking** (line 176-177, read directly):
```typescript
const storeOff = store.data ? store.data.ordering_enabled === false : false;
const ctaDisabled = storeOff || hasFieldErrors || submitting;   // ← storeOff must be removed here
```

**Exact banner block to change tone/copy** (lines 266-281, read directly):
```tsx
{storeOff && store.data && (
  <BannerNotice
    tone={store.data.blocking_reason === 'OUTSIDE_HOURS' ? 'warn' : 'brand'}
    title={store.data.blocking_reason === 'OUTSIDE_HOURS' ? '...' : '...'}
    body={...}
    action={{ label: 'Gọi quán', href: store.data.store_phone }}
  />
)}
```
Per D-11, this becomes a single unconditional-when-closed `tone="info"` banner using `store.data.closed_banner_text` verbatim (no BE-composed sentence assembly needed anymore since the copy is now fully server-configured) — the `blocking_reason === 'OUTSIDE_HOURS' ? warn : brand` ternary and the 2 hardcoded title/body strings should be deleted, not extended with a 3rd branch.

**`errorAction()` dead codes** (lines 94-99, read directly): `ONLINE_ORDERING_DISABLED`/`STORE_CLOSED` in this `if` are now unreachable from the submit-error path (BE never throws them per D-11) — but `NO_TABLE_AVAILABLE`/`PHONE_BLACKLISTED` in the same `if` remain live, so this is a partial edit, not a block deletion. Cross-check against the updated `order-guard.ts` union before removing.

---

### `apps/shop/src/pages/OrderTrackPage.tsx` (MODIFY, insert REQ-O)

**Exact insertion point** (line 64-67, read directly, comment already present):
```tsx
{/* ── Chỗ chèn phase 9 (REQ-O): banner % tiến độ + 5 mốc trạng thái +
    banner "quán vừa cập nhật đơn" đặt NGAY TẠI ĐÂY, phía trên danh sách
    món bên dưới. ... ── */}
```
**Icon convention to copy** (`CheckGlyph`, lines 97-114): hand-drawn SVG, `stroke="var(--herb-600)"`, `strokeWidth={2}` — new stepper node icons (check mark, X for rejected) must follow this exact SVG-attribute convention, not import an icon package (hard bundle-budget constraint, see below).
**`BannerNotice` usage convention** (lines 40-46): `<BannerNotice tone="danger" title={...} action={...}/>` — the rejected-state banner and the "cancelled items" banner both reuse this exact component/prop shape, just with `tone="danger"` and `tone="info"` respectively (the latter requires the `BannerNotice` edit above).
**Token-based styling convention** (entire `const X: CSSProperties = { ... 'var(--...)' }` blocks, lines 136-269): every new style constant for the stepper must follow this same pattern — no hardcoded hex/px, always `var(--sp-*)`/`var(--fs-*)`/`var(--ok-*)` etc., per the hard project rule already stated in RESEARCH.md and UI-SPEC.

**⚠ HARD BUNDLE CONSTRAINT:** current build is 352 kB / 370 kB gate (~18 kB headroom, ~4.9%). Any analog or approach that implies a **new npm dependency** for `apps/shop` (chart lib, animation lib, icon package) is **BLOCKED** — must be implemented with CSS (`flex`, `border-radius`, `transform`/`opacity` transitions) + hand-drawn SVG only, matching `CheckGlyph`'s existing convention. Run `sh scripts/check-shop-bundle.sh` after any addition here.

---

## Shared Patterns

### Route prefix convention (OD-08) — applies to all new admin backend routes
**Source:** `apps/api/src/modules/settings/settings.controller.ts` line 1-5 docblock + `tables.controller.ts` line 63 (`@Controller('tables')`).
**Apply to:** `admin-online-orders.controller.ts` — must be `@Controller('admin/online-orders')`, **NOT** `@Controller('api/admin/online-orders')` as the original spec prose says. `/admin/*` is already covered by both the SPA-fallback `apiPrefixes` check and `pathRequiresCheck()` CSRF guard (per RESEARCH.md, confirmed — no separate edit needed to CSRF path config).

### Role-based access (D-02) — applies to controller + FE route
**Source:** `apps/api/src/modules/auth/guards/roles.guard.ts` (`RequireRoles`) for BE; `apps/web/src/App.tsx` `<RoleGate allow={[...]}/>` for FE. Both already exist and are directly reusable, no new guard/gate code needed — only new *usages* of each.

### Async event emit/consume (SSE fan-out) — applies to controller + service
**Source:** `apps/api/src/modules/audit/audit.interceptor.ts` lines 108, 114-128 — `emitter.emit(name, payload)` fire-and-forget on the write side; `@OnEvent(name, { async: true })` + try/catch-and-log (never throw) on the consume side. `EventEmitterModule.forRoot()` already global via `app.module.ts:24`.

### Pure-function module discipline — applies to all new `*.ts` utility files under `public/` and `admin-online-orders/`
**Source:** `apps/api/src/modules/public/store-status.ts` (whole-file convention, confirmed): no `@nestjs/*`/`typeorm` imports, `nowMs` always an explicit param (never `Date.now()` internally), table-of-cases unit tests in a sibling `*.test.ts`. Applies to `order-progress.ts` and `table-assign.ts`.

### Settings key-value round-trip — applies to any new config key
**Source:** `apps/api/src/modules/settings/settings.defaults.ts` + `settings.service.ts` (`updateMany()` line 68-83) + `settings.controller.ts` (`update()` allowlist lines 118-130). 3-place checklist for every new key: (1) `SETTINGS_DEFAULTS` array entry + `StoreSettingsMap` type field, (2) `settings.controller.ts` DTO field + allowlist array, (3) whichever public/admin response builder needs to surface it (`buildResponse()`/`getStore()`). Missing any one of the 3 causes a **silent** no-op save (`if (!kind) continue`), not an error.

### Design-token discipline (apps/shop only) — applies to all new shop styles
**Source:** `apps/shop/src/styles/tokens.css` + every `CSSProperties` const in `OrderTrackPage.tsx`/`BannerNotice.tsx`. Always `var(--...)`, never hardcoded hex/px. Does **not** apply to `apps/web` (that codebase is intentionally hardcoded hex — do not introduce a token system there, per UI-SPEC's explicit instruction).

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `apps/api/src/modules/admin-online-orders/admin-online-orders.controller.ts` (SSE portion only) | controller | streaming | No `@Sse()` endpoint exists anywhere in the repo yet. Use RESEARCH.md Pattern 1 (official NestJS docs, already fully worked out with code) instead of a repo file. |
| `apps/api/src/modules/notifications/outbox-poller.ts` | service | batch/cron | `@nestjs/schedule` is not yet a dependency (must be installed, see RESEARCH.md Environment Availability) and no `@Cron()` usage exists in repo. Use RESEARCH.md Pattern 3 (official NestJS Task Scheduling docs). |
| `apps/api/src/modules/notifications/channels/sms-channel.ts` / `email-channel.ts` | service | dispatch | No SMS/Email sending code exists anywhere in the repo (M2.D-63/D-38 describe the intended design but it was never built pre-phase-9). Build fresh per spec §4.6/M2.D-63, no repo analog to copy from. |
| `apps/web/src/lib/bell-unlock.ts` | utility | audio unlock | No audio-playback code exists anywhere in `apps/web`. Use RESEARCH.md Pattern 4 (Chrome for Developers + MDN, already includes a ready-to-copy `tryPlay()` function) as the source instead of a repo file. |

## Metadata

**Analog search scope directories:** `apps/api/src/modules/{public,orders,tables,settings,audit,auth,admin,menu,cli}`, `apps/web/src/{pages,components,lib}`, `apps/shop/src/{pages,components,styles}`, `packages/schemas/src`, `apps/api/src/{app.module.ts,data-source.ts}`
**Files read in full or targeted-range during this mapping:** `open-order-lock.integration.test.ts`, `audit.interceptor.ts`, `orders.service.ts` (lines 175-289), `tables.controller.ts` (lines 1-90), `data-source.ts`, `order-guard.ts`, `order-guard.test.ts`, `submit-order.ts`, `store-status.ts`, `settings.service.ts`, `settings.defaults.ts`, `settings.controller.ts`, `app.module.ts`, `order.entity.ts`, `public-orders.service.ts`, `public-orders.controller.ts`, `packages/schemas/src/public-orders.ts`, `cron-audit-retention.ts`, `cron-jti-cleanup.ts`, `online-order-request.entity.ts`, `users.controller.ts` (lines 1-70), `roles.guard.ts`, `App.tsx`, `NotificationBell.tsx`, `item-age.ts`, `Toast.tsx`, `AdminSettingsPage.tsx` (lines 280-380 + targeted grep), `OrderTrackPage.tsx`, `BannerNotice.tsx`, `CheckoutPage.tsx` (lines 75-200, 255-315, 420-470), `public-store.ts` (schema), `public-store.controller.ts`, `orders.module.ts`, `MenuManagementPage.tsx` (targeted grep only, per constraint not to disturb uncommitted edit)
**Pattern extraction date:** 2026-07-31
