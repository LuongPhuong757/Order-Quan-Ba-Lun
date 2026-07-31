# Phase 9: Duyệt đơn, Thông báo & Theo dõi đơn - Research

**Researched:** 2026-07-31
**Domain:** NestJS SSE fan-out, MySQL row-lock transactions, browser audio autoplay, in-process cron scheduling, React tracking UI
**Confidence:** MEDIUM-HIGH (phần lớn framework primitives xác nhận qua doc chính thức + code hiện có; công thức nghiệp vụ và schema đã LOCKED ở spec/CONTEXT)

## Summary

Phase 9 vừa xây tính năng mới (hàng chờ duyệt + SSE + outbox thông báo + trang tracking đầy đủ) vừa **sửa lại phase 8** vì công tắc nhận đơn đổi ngữ nghĩa (D-11/D-12 ghi đè M2.D-26/27/33/36/60). Ba phần hạ tầng "chưa từng làm" trong repo — SSE, cron in-process, test integration MySQL 2-connection — đã có tiền lệ trực tiếp để tái dùng: `@nestjs/event-emitter` đã được đăng ký sẵn ở `app.module.ts:24` và có 1 ví dụ dùng thật (`audit.interceptor.ts`); harness integration 2-`QueryRunner` MySQL thật đã tồn tại nguyên khuôn ở `open-order-lock.integration.test.ts`. Cái duy nhất **thật sự thiếu** là gói `@nestjs/schedule` (chưa có trong `package.json`, cần cài — đã xác minh version 6.1.3 tương thích Nest 10, `[OK]` qua slopcheck).

Toàn bộ entity/table cho phase 9 (`online_order_requests` đã có từ phase 8, cột `orders.source/fulfillment_type/...` theo §4.5, bảng `notification_outbox`) **chưa tồn tại trên `Order` entity** — đây là việc đầu tiên phải làm trước khi viết logic xác nhận đơn. Route admin mới phải tuân thủ OD-08 (không tiền tố `/api`) và may mắn là `/admin/*` đã nằm sẵn trong cả `apiPrefixes` (SPA fallback) lẫn `pathRequiresCheck()` (CSRF guard) — không cần sửa 2 chỗ đó.

**Primary recommendation:** Xây `AdminOnlineOrdersModule` mới (entity columns trên `Order`, `NotificationOutbox` entity, service dùng transaction + `FOR UPDATE` phỏng theo `getOrCreateOpenOrderImpl`/`runWithRetry` đã có, SSE qua `@Sse()` + `EventEmitter2`, poller qua `@nestjs/schedule` `@Cron('*/15 * * * * *')`), đồng thời sửa 5 điểm code phase 8 đã liệt kê ở D-17 để khớp ngữ nghĩa công tắc 2 trạng thái mới.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Duyệt/từ chối đơn + cấp bàn (row lock) | API/Backend (`AdminOnlineOrdersService`) | Database (InnoDB `FOR UPDATE`) | Toàn bộ tính đúng đắn (không cấp trùng bàn) sống ở transaction MySQL, không phải ở code Node |
| SSE fan-out tới nhiều tab admin | API/Backend (in-process `EventEmitter2` + `@Sse()`) | — | C-INFRA-01 cấm 1 DB connection/subscriber — fan-out phải thuần in-memory, không polling DB |
| Chuông + banner "Bật chuông" | Browser/Client (`apps/web`) | — | Autoplay policy chỉ giải quyết được ở client, không có API server-side nào bypass được |
| Poller outbox 15s + 2 cron hồi sinh | API/Backend (`@nestjs/schedule` in-process) | Database (bảng `notification_outbox`) | Đơn giản hoá vòng đời: 1 process, không thêm sidecar/container mới |
| % tiến độ + 5 mốc tracking | API/Backend (tính tại `GET /api/public/orders/:token`) | Browser/Client (`apps/shop` chỉ render, poll 5-10s) | Logic tính `percent`/`max_progress_shown` phải nằm 1 chỗ (BE) để đơn điệu đúng — FE không tự suy percent |
| Công tắc "Mở/Đóng cửa" (đổi ngữ nghĩa) | API/Backend (`store-status.ts`, chỉ đổi copy, giữ cơ chế) | Browser/Client (`apps/shop` banner cố định) | `evaluateOrderingStatus()` vẫn là nguồn sự thật; FE chỉ đổi cách hiển thị, không chặn gì |
| 4 ô chữ cấu hình (D-14) | API/Backend (`SettingsService`, thêm 4 key `string`) | Browser/Client (`AdminSettingsPage` form) | Mẫu key-value settings đã có sẵn, chỉ thêm entry — không dựng bảng/API mới |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@nestjs/event-emitter` | ^2.1.0 (đã có, xác nhận qua `package.json`) | Fan-out in-process cho SSE (`online_order.new`/`online_order.reviewed`) | `EventEmitterModule.forRoot()` đã đăng ký ở `app.module.ts:24`; đã có 1 pattern dùng thật ở `audit.interceptor.ts` (`emitter.emit('audit.write', ev)` + `@OnEvent('audit.write')`) — copy nguyên khuôn |
| `@nestjs/schedule` | **6.1.3** [VERIFIED: npm registry — `npm view @nestjs/schedule version`, peerDependencies `@nestjs/core: ^10.0.0 \|\| ^11.0.0` khớp `^10.4.0` đang dùng] | `@Cron('*/15 * * * * *')` cho poller outbox + hồi sinh 2 cron chết (D-19) | Package chính thức NestJS, cùng org scope với các gói `@nestjs/*` đã dùng; thay thế external OS cron mà repo chưa từng wire được (C-CRON-01) |
| RxJS `Observable`/`Subject` | theo version bundled với NestJS (đã có transitive dep) | `@Sse()` handler trả `Observable<MessageEvent>` | Bắt buộc theo API `@Sse()` của NestJS — không có cách khác để trả SSE stream |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Zod (`packages/schemas`) | đã có trong monorepo | Mở rộng `PublicOrderStatus` (percent/stage/5 mốc), thêm schema admin online-orders | Theo đúng pattern hiện có — mọi response `/api/public/*` đã `.strict().parse()` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@nestjs/schedule` cron string | `setInterval` thô trong `onModuleInit` | Mất tính năng dừng/dynamic scheduling của `SchedulerRegistry`, không theo convention NestJS — không có lý do chọn cái này |
| `@Sse()` observable tự viết bằng `EventEmitter2` | WebSocket (`@nestjs/websockets`) | Spec + ROADMAP đã chốt SSE (C-INFRA-01), không cần 2 chiều — WebSocket là over-engineering cho use case "server đẩy 1 chiều" |
| Poll `GET /api/admin/online-orders` mỗi lần SSE reconnect (D-06) | Giữ `Last-Event-ID` + replay buffer trong RAM | Chủ dự án đã chốt KHÔNG dùng replay buffer — DB luôn là nguồn sự thật duy nhất |

**Installation:**
```bash
pnpm --filter @order/api add @nestjs/schedule@6.1.3
```
(máy này `pnpm` hỏng — nếu cần cài thủ công, thêm dòng vào `apps/api/package.json` dependencies rồi chạy lại install theo cách đang dùng trên máy, xem `apps/api/node_modules/.bin/` đã có sẵn `tsc`/`vitest` để verify sau khi thêm.)

**Version verification:** đã chạy `npm view @nestjs/schedule version` (kết quả `6.1.3`, publish `time.modified: 2026-04-15`) và `npm view @nestjs/schedule@6.1.3 peerDependencies` (khớp Nest 10) trong phiên nghiên cứu này.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `@nestjs/schedule` | npm | nhiều năm (org chính thức NestJS, version hiện tại 6.1.3 publish 2026-04-15) | rất cao (core NestJS ecosystem package) | github.com/nestjs/schedule | **[OK]** (chạy `slopcheck install @nestjs/schedule` trong phiên này — kết quả "1 OK", npm registry check thành công; lỗi cuối log là do `npm install` thất bại trong monorepo pnpm, không liên quan tới verdict legitimacy) | Approved |

**Packages removed do slopcheck [SLOP] verdict:** none
**Packages flagged suspicious [SUS]:** none

Đây là gói duy nhất phase 9 cần thêm mới. Không có SDK riêng cho eSMS (M2.D-63 — `EsmsChannel` gọi thẳng HTTP API bằng driver hiện có trong dự án, không phải quyết định của research này, xem "KHÔNG cần nghiên cứu").

## Architecture Patterns

### System Architecture Diagram

```
Khách (apps/shop)                     Admin (apps/web /admin/online-orders)
   │ POST /api/public/orders               │ GET /admin/online-orders?status=WAITING (initial load)
   │ (đã có từ phase 8)                     │ GET /admin/online-orders/stream  (SSE, giữ mở)
   ▼                                        │
┌─────────────────────────────────────────────────────────────────────────┐
│ PublicOrdersService.submit() [đã có]                                     │
│   INSERT online_order_requests (WAITING)                                 │
│   INSERT notification_outbox: L1 SSE(now), L3 EMAIL(now),                │
│           L2 SMS(now+90s), [L4 AUTOOFF bị bỏ theo D-12]                  │
│   emitter.emit('online_order.new', {...})  ───────────────┐             │
└──────────────────────────────────────────────────────────  │             │
                                                              ▼             │
                                              ┌───────────────────────────┐ │
                                              │ EventEmitter2 (in-process)│ │
                                              └──────────────┬────────────┘ │
                                                              │ @OnEvent    │
                                                              ▼             │
                                        ┌─────────────────────────────────┐│
                                        │ SSE Controller (@Sse stream)     ││
                                        │ mỗi subscriber = 1 rxjs Subject   ││
                                        │ KHÔNG mở connection DB riêng      ││
                                        └──────────────┬───────────────────┘│
                                                       │ push event         │
                                                       ▼                    │
                                    Mọi tab admin/order/kitchen đang mở ─────┘
                                    (badge + chuông + reload queue)

Admin bấm XÁC NHẬN
   │
   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ AdminOnlineOrdersService.confirm(id, actor)                              │
│   ds.transaction(mgr => {                                                │
│     SELECT ... FROM restaurant_tables WHERE kind=:k AND is_active        │
│       AND NOT kiotviet_locked AND id NOT IN (open orders)                │
│       ORDER BY code ASC LIMIT 1 FOR UPDATE                                │
│     không có bàn → tự tạo (theo KIND_FORMAT ship-/mang-ve- đã có)        │
│     getOrCreateOpenOrder(...) [tái dùng OrdersService]                   │
│     set order.source='ONLINE', fulfillment_type, customer_*, order_token │
│     add items từ items_snapshot → transition PENDING→KITCHEN             │
│     request.status='CONFIRMED', order_id, reviewed_by, reviewed_at       │
│   }, retry qua runWithRetry-style helper khi deadlock)                    │
│   huỷ outbox L2/L4 PENDING của request này                                │
│   emitter.emit('online_order.reviewed', {...})                           │
└─────────────────────────────────────────────────────────────────────────┘

Poller (mỗi 15s, @nestjs/schedule @Cron)
   │ SELECT * FROM notification_outbox WHERE scheduled_at <= NOW() AND status='PENDING'
   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Dispatch theo channel: SSE (đã bắn lúc insert, outbox chỉ audit) /       │
│ SMS (SmsChannel.send, retry + backoff, ghi status SENT/FAILED) /         │
│ EMAIL (EmailChannel tổng hợp cuối ngày — không liên quan L2 90s)         │
└─────────────────────────────────────────────────────────────────────────┘

Khách xem /o/:token (apps/shop, poll 5-10s)
   │ GET /api/public/orders/:token
   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ PublicOrdersService.getByToken() — MỞ RỘNG (phase 9):                    │
│   computeProgress(order, fulfillment_type, max_progress_shown) theo §6    │
│   persist max_progress_shown = max(percent, cũ) — đơn điệu                │
│   trả stage/stage_label/percent/cancelled_count/eta — KHÔNG BAO GIỜ       │
│   trả status từng item (M2.D-23, hard gate G-1)                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure
```
apps/api/src/modules/
├── public/
│   ├── public-orders.service.ts     # MỞ RỘNG getByToken() thêm % + stage (không tạo file mới)
│   ├── order-progress.ts            # MỚI — hàm thuần computeProgress() theo §6, test riêng
│   └── store-status.ts              # SỬA copy/semantics theo D-11, KHÔNG đổi cơ chế tính-lúc-đọc (OD-07)
├── admin-online-orders/             # MỚI (module riêng, không nhét vào orders/ hiện có)
│   ├── admin-online-orders.module.ts
│   ├── admin-online-orders.controller.ts   # GET list, POST confirm, POST reject, GET stream (SSE)
│   ├── admin-online-orders.service.ts      # transaction cấp bàn + gọi OrdersService.getOrCreateOpenOrder
│   ├── table-assign.ts              # hàm thuần: chọn bàn theo kind+code ASC, hoặc tự sinh code mới
│   └── admin-online-orders.integration.test.ts  # theo khuôn open-order-lock.integration.test.ts
├── notifications/                   # MỚI
│   ├── entities/notification-outbox.entity.ts
│   ├── notification-outbox.service.ts   # insert L1-L3 tại submit, cancel L2 khi confirm/reject
│   ├── outbox-poller.ts             # @Cron 15s — quét + dispatch
│   ├── channels/sms-channel.ts      # interface + ConsoleSmsChannel + EsmsChannel (SMS_DRIVER)
│   ├── channels/email-channel.ts
│   └── cron-audit-retention.cron.ts # WIRE lại logic CLI cũ vào @Cron, KHÔNG viết lại business logic
│   └── cron-jti-cleanup.cron.ts
└── settings/
    └── settings.defaults.ts         # THÊM 4 key string cho D-14 (banner/copy đóng cửa)

apps/web/src/pages/
└── OnlineOrdersQueuePage.tsx        # MỚI — /admin/online-orders, RoleGate allow=['admin','order','kitchen']
apps/web/src/lib/
└── bell-unlock.ts                   # MỚI — audio unlock pattern (D-03/D-04)

apps/shop/src/pages/
├── OrderTrackPage.tsx               # MỞ RỘNG (không viết lại) — thêm % + 5 mốc + banner cập nhật
└── CheckoutPage.tsx                 # SỬA banner "đóng cửa" theo D-11 (không xoá field, đổi copy/logic khoá nút)
```

### Pattern 1: SSE fan-out qua EventEmitter2 (đã có tiền lệ trong repo)
**What:** Controller trả `Observable<MessageEvent>` bằng cách bọc `EventEmitter2` bằng `fromEvent()`/`Subject`, publisher chỉ gọi `emitter.emit(...)`.
**When to use:** Endpoint `GET /admin/online-orders/stream`.
**Example (khuôn có sẵn, chỉ đổi tên event):**
```typescript
// Nguồn: apps/api/src/modules/audit/audit.interceptor.ts (pattern emit/consume đã chạy thật)
// Publisher (trong service xử lý submit/confirm/reject):
constructor(private readonly emitter: EventEmitter2) {}
this.emitter.emit('online_order.new', { id, submitted_at });

// SSE Controller — dùng rxjs fromEvent trên EventEmitter2 instance:
import { fromEvent, merge, timer } from 'rxjs';
import { map, takeUntil } from 'rxjs/operators';

@Sse('stream')
stream(@Req() req: Request): Observable<MessageEvent> {
  const close$ = fromEvent(req, 'close'); // dọn subscriber khi client ngắt
  const events$ = merge(
    fromEvent(this.emitter, 'online_order.new'),
    fromEvent(this.emitter, 'online_order.reviewed'),
  ).pipe(map((data) => ({ data }) as MessageEvent));
  const heartbeat$ = timer(15_000, 15_000).pipe(map(() => ({ data: { type: 'heartbeat' } }) as MessageEvent));
  return merge(events$, heartbeat$).pipe(takeUntil(close$));
}
```
**Nguồn:** [NestJS official docs — Server-Sent Events](https://docs.nestjs.com/techniques/server-sent-events), pattern emit/consume xác nhận tại `apps/api/src/modules/audit/audit.interceptor.ts:74-118` (đã chạy production).

### Pattern 2: Cấp bàn trong transaction + `FOR UPDATE`, tự tạo bàn khi hết
**What:** Trong 1 `ds.transaction()`, `SELECT ... FOR UPDATE` bàn trống theo `kind` + `code ASC`; không có → INSERT bàn mới dùng đúng `KIND_FORMAT` đã có (`ship-NN` cho delivery, `mang-ve-NN` cho takeaway — **không phải** `SHIP-NN`/`TAKE-NN` như văn xuôi spec ghi, xem `tables.controller.ts:57-60`).
**When to use:** `AdminOnlineOrdersService.confirm()`.
**Khác gì lock của phase 8 (`open-order-lock.integration.test.ts`):** phase 8 dùng `FOR UPDATE` trên bảng `online_order_requests` (gap lock khi KHÔNG tìm thấy hàng — chặn insert trùng). Phase 9 dùng `FOR UPDATE` trên `restaurant_tables` (record lock trên các hàng TÌM THẤY — chặn 2 transaction cùng chọn 1 bàn). Cùng cơ chế InnoDB, khác loại lock (gap vs record) vì câu query khác (tồn tại hàng khớp vs không).
**Ràng buộc quan trọng:** `runWithRetry()` hiện là **method `private` của `OrdersService`** (`orders.service.ts:189`), KHÔNG export. Phase 9 cần 1 trong 2: (a) copy logic retry (10 dòng, đã có sẵn để chép) vào service mới, hoặc (b) đổi `private` → `protected`/export thành hàm thuần dùng chung. Planner phải quyết định tường minh — không giả định nó "đã sẵn dùng được" như CONTEXT.md ngụ ý.
**Test:** copy khuôn `open-order-lock.integration.test.ts` — 2 `QueryRunner` riêng, `startTransaction()`, race bằng `Promise.race([queryPromise, sleep(500)])` để chứng minh 1 bên bị chặn.

### Pattern 3: Poller outbox dùng `@Cron` string thay vì `setInterval`
**What:** `@Injectable() class OutboxPoller { @Cron('*/15 * * * * *') async tick() {...} }`, đăng ký `ScheduleModule.forRoot()` ở `app.module.ts`.
**When to use:** Quét `notification_outbox` mỗi 15s, và 2 job hồi sinh (`cron-audit-retention`, `cron-jti-cleanup`) chạy theo lịch riêng (`@Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)` hoặc tương tự — chọn lịch cụ thể là discretion, không phải nghiên cứu).
**Cách hồi sinh 2 cron chết mà KHÔNG viết lại logic:** 2 file `apps/api/src/cli/cron-audit-retention.ts` và `cron-jti-cleanup.ts` hiện tự gọi `AppDataSource.initialize()`/`.destroy()` (bootstrap TypeORM thô, không qua Nest DI — xem Anti-Pattern "Dual DataSource lifecycles" ở `ARCHITECTURE.md`). Cách nối dây đúng: viết 1 `@Injectable` service mới inject `Repository<AuditLog>`/`Repository<OrderActivityLog>`/`Repository<RevokedJti>` qua Nest DI (connection đã sống sẵn trong process HTTP server), rồi **gọi lại đúng câu query** đã có trong 2 file CLI (không đổi logic xoá/điều kiện `cutoff_ts_ms`), bọc trong `@Cron`. Giữ nguyên 2 file CLI cũ cho khả năng chạy tay/dry-run (đừng xoá `pnpm cron:*` scripts).
**Nguồn:** [NestJS official docs — Task Scheduling](https://docs.nestjs.com/techniques/task-scheduling), cấu trúc CLI hiện có xác nhận tại `apps/api/src/cli/cron-audit-retention.ts`, `cron-jti-cleanup.ts`.

### Pattern 4: Mở khoá audio bằng user gesture, phát lại không cần gesture sau đó
**What:** Chrome/Safari chặn `HTMLAudioElement.play()` không có "user activation" — promise reject với `NotAllowedError`. Sau 1 lần `.play()` thành công TỪ TRONG event handler của 1 cú click, trình duyệt cấp "activation" cho phần tử/tab đó; các lần `.play()` sau (kể cả gọi từ `setInterval` không có gesture) vẫn thành công **trong cùng session/tab**, tới khi reload trang.
**When to use:** Nút "Bật chuông" bắt buộc (D-03) — gọi `audio.play()` ngay trong `onClick` handler của chính nút đó (không phải sau 1 `await` dài, vì "gesture" hết hiệu lực nếu có async gap quá lâu trước lệnh `.play()` đầu tiên).
**Cách phát hiện bị chặn:** `await audio.play()` ném `NotAllowedError` (DOMException) — bắt bằng `try/catch`, set state `blocked=true` → hiện banner đỏ (D-03). Gọi lại `.play()` trong click handler của banner đó để unlock.
**Example:**
```typescript
// apps/web/src/lib/bell-unlock.ts (mới)
async function tryPlay(audio: HTMLAudioElement): Promise<'ok' | 'blocked'> {
  try {
    await audio.play();
    audio.pause();       // chỉ cần unlock, không phát tiếng ngay lúc bấm nút
    audio.currentTime = 0;
    return 'ok';
  } catch (err) {
    if ((err as DOMException).name === 'NotAllowedError') return 'blocked';
    throw err;
  }
}
```
**Nguồn:** [Chrome for Developers — Autoplay Policy in Chrome](https://developer.chrome.com/blog/autoplay), [MDN — HTMLMediaElement.play()](https://developer.mozilla.org/docs/Web/API/HTMLMediaElement/play) — cả 2 xác nhận `NotAllowedError` là error type cụ thể cần bắt.

### Anti-Patterns to Avoid
- **Giữ 1 kết nối MySQL riêng mỗi SSE subscriber để "poll" thay đổi:** vi phạm thẳng C-INFRA-01. SSE endpoint KHÔNG được tự query DB định kỳ — chỉ forward event đã emit từ nơi khác (service ghi DB xong mới emit).
- **Dùng `Last-Event-ID`/replay buffer cho SSE reconnect:** D-06 đã chốt ngược lại — FE luôn gọi lại `GET .../online-orders?status=WAITING` khi mở/nối lại SSE, không giữ lịch sử event trong RAM server.
- **Gọi `.play()` bên trong `setInterval` mà CHƯA từng có 1 lần `.play()` thành công từ user gesture trước đó:** sẽ luôn bị chặn — không có cách nào "xin phép" audio ngoài user gesture thật.
- **Copy `AppDataSource.initialize()`/`.destroy()` pattern của CLI script vào code chạy trong HTTP server:** tạo dual-DataSource-lifecycle mới (đã là Anti-Pattern ghi trong `ARCHITECTURE.md`) — cron mới PHẢI dùng DI injection vào connection pool đã có của Nest app.
- **Rename bất kỳ cột nào trong `online_order_requests`/`orders`:** `synchronize: true`, không migration (C-SCHEMA-07) — rename = mất dữ liệu im lặng. Chỉ ADD cột mới theo §4.5.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Lên lịch chạy định kỳ trong Node process | `setInterval`/`setTimeout` đệ quy tự viết | `@nestjs/schedule` `@Cron()` | Có `SchedulerRegistry` để inspect/dừng job từ ngoài, cron string chuẩn, tránh drift tích luỹ của `setTimeout` đệ quy |
| Retry khi deadlock MySQL | Thư viện retry tổng quát (`p-retry`, `async-retry`) | Copy/tái dùng logic `runWithRetry` đã có (regex `/deadlock|lock wait timeout|ER_LOCK/i`, 2 lần, sleep ngẫu nhiên) | Logic đã match đúng error message MySQL2/TypeORM thật trong repo này; thư viện ngoài không biết phân biệt transient vs permanent error theo message cụ thể này |
| Real-time push tới nhiều tab | WebSocket, Socket.io, Pusher/Ably (SaaS) | `@Sse()` + `EventEmitter2` in-process | 1 chiều server→client là đủ (không cần client gửi ngược qua kênh này); thêm dependency ngoài cho use case 1-chiều là over-engineering, đã chốt ở ROADMAP note |
| Chặn 2 admin cấp trùng bàn | Application-level mutex / distributed lock (Redis) | MySQL `SELECT ... FOR UPDATE` trong transaction | Đã có pattern y hệt chạy trong repo (`open-order-lock.integration.test.ts`); không cần thêm Redis cho 1 quán quy mô nhỏ |
| Phát hiện browser chặn audio | Thư viện autoplay-detection ngoài (`ion.sound`, v.v.) | `await audio.play()` + bắt `NotAllowedError` | API chuẩn, không cần dependency; hành vi đã tài liệu hoá rõ ràng qua Chrome for Developers |

**Key insight:** Mọi "hạ tầng mới" của phase 9 (SSE, cron, row-lock retry) đều đã có 1 mảnh tiền lệ chạy thật trong chính repo này — rủi ro lớn nhất không phải "chọn sai công nghệ" mà là **quên tái dùng** và vô tình dựng ra pattern thứ hai (dual DataSource, mutex tự chế) chồng lên pattern đã có.

## Runtime State Inventory

*(Không áp dụng đầy đủ khuôn "rename/refactor" — nhưng phase 9 CÓ đổi ngữ nghĩa 1 cấu hình runtime đang tồn tại, nên vẫn kiểm 5 hạng mục cho phần đó.)*

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Không có dữ liệu nào cần migrate — `online_ordering_off_mode`/`online_ordering_off_until_ms` (kiểu OFF hiện có) **giữ nguyên cơ chế lưu trữ**, chỉ đổi ý nghĩa hiển thị/tác dụng (D-11). `escalate_autooff_after_s` là 1 key `store_settings` đơn lẻ, không có bảng con nào tham chiếu nó. | Không migrate dữ liệu — chỉ đổi code đọc/hiển thị. Nếu chọn XOÁ hẳn key `escalate_autooff_after_s` (1 trong 2 lựa chọn discretion D-12), cần xoá cả entry trong `SETTINGS_DEFAULTS` (`settings.defaults.ts:36`) — hàng cũ trong DB (nếu admin từng ghi) sẽ bị `readAll()` bỏ qua tự nhiên (`if (!kind) continue`), không cần xoá tay row đó. |
| Live service config | Không có — mọi cấu hình liên quan (`online_ordering_*`) sống trong bảng `store_settings` của chính app, không có service ngoài (n8n, Datadog...) nào giữ bản sao. | Không cần |
| OS-registered state | Không có — 2 cron chết (`cron-audit-retention.ts`, `cron-jti-cleanup.ts`) hiện **không được** OS cron/systemd nào gọi (xác nhận qua `docker-compose*.yml` — không có entry). Không có Task Scheduler/pm2/launchd nào cần re-register vì chưa từng được register ở đâu. | Wire vào `@Cron` in-process (D-19) — không cần sửa gì ở tầng OS vì chưa từng có |
| Secrets/env vars | Không phát sinh secret mới. `SMS_DRIVER` (M2.D-63) là biến môi trường mới nhưng thuộc phạm vi thi công phase 9, không phải biến đang tồn tại bị đổi tên. | Thêm `SMS_DRIVER` vào `.env.example` khi thi công (không phải việc của research) |
| Build artifacts | `apps/shop/dist` sẽ tăng dung lượng khi thêm code tracking đầy đủ — xem "Gate bundle" bên dưới, không phải build artifact stale cần dọn. | Theo dõi ngưỡng `check-shop-bundle.sh`, không phải hành động dọn dẹp |

## Common Pitfalls

### Pitfall 1: Caddy có buffer response SSE hay không — ĐÃ XÁC MINH: KHÔNG, tự động
**What goes wrong (nếu không biết):** Lo ngại Caddy đứng trước API sẽ buffer response SSE, làm độ trễ >2s hoặc badge "trông như đứng yên".
**Sự thật đã xác minh:** Theo tài liệu chính thức Caddy, `reverse_proxy` **tự động** flush ngay lập tức khi response có `Content-Type: text/event-stream` — không cần cấu hình `flush_interval` thủ công trong `Caddyfile`. NestJS `@Sse()` tự set đúng header này.
**Cách tránh:** Không cần sửa `Caddyfile` cho mục đích này (khác với `Permissions-Policy`/`Referrer-Policy` đã sửa ở OD-01/OD-02 cho lý do khác). Nếu vẫn muốn phòng thủ tuyệt đối, thêm `flush_interval -1` cho riêng route `/admin/online-orders/stream` — nhưng đây là optional, không phải fix cho bug đã biết.
**Warning signs:** Nếu sau này thấy SSE trễ >2s trong môi trường có Caddy, kiểm tra trước hết là NestJS có set đúng `Content-Type: text/event-stream` không (một số middleware ghi đè header có thể vô tình đổi content-type), không phải nghi ngờ Caddy trước.

### Pitfall 2: `runWithRetry` là `private method`, không phải hàm dùng chung
**What goes wrong:** Giả định "cứ import và gọi `runWithRetry` từ `OrdersService`" — không được, nó là `private` (orders.service.ts:189), TypeScript sẽ chặn biên dịch nếu gọi từ ngoài class.
**Why it happens:** CONTEXT.md liệt kê nó ở "Reusable Assets" nhưng không nói rõ nó private — dễ hiểu lầm là public util.
**How to avoid:** Planner phải quyết định 1 trong 2 hướng và ghi rõ trong plan: (a) đổi `private` → export thành hàm thuần độc lập (refactor nhỏ, dùng được cho cả `OrdersService` lẫn `AdminOnlineOrdersService`), hoặc (b) copy 15 dòng logic. Hướng (a) tốt hơn về lâu dài (DRY) nhưng động vào file 1315 dòng đã biết là fragile (`ARCHITECTURE.md` "Fragile Areas") — cân nhắc rủi ro regression khi lên plan.
**Warning signs:** Lỗi TypeScript "Property 'runWithRetry' is private" khi build — bắt được ngay ở `tsc --noEmit`, không phải runtime bug ẩn.

### Pitfall 3: Table code convention thật KHÁC văn xuôi spec
**What goes wrong:** Code tự tạo bàn theo tên `SHIP-NN`/`TAKE-NN` (chữ hoa, theo mô tả tường thuật ở spec §7) trong khi hệ thống thật dùng `ship-NN`/`mang-ve-NN` (chữ thường, theo `KIND_FORMAT` ở `tables.controller.ts:57-60`) — gây bàn tự tạo không nhất quán với bàn tạo tay qua `/tables`.
**Why it happens:** Spec (`docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md`) là văn bản mô tả ý tưởng, viết trước khi `KIND_FORMAT` được code hoá ở phase sớm hơn milestone 1.
**How to avoid:** Tái dùng đúng `KIND_FORMAT` map (`{ 'takeaway': { codePrefix: 'mang-ve', ... }, 'delivery': { codePrefix: 'ship', ... } }`) khi tự sinh code bàn mới trong transaction cấp bàn — không hardcode string mới. `fulfillment_type` map: `PICKUP` → `kind='takeaway'`, `DELIVERY` → `kind='delivery'` (đúng §7 pseudo-code).
**Warning signs:** Nếu review thấy string `'SHIP-'` hoặc `'TAKE-'` (chữ hoa) trong code mới — đó là dấu hiệu đọc nhầm spec thay vì đọc code thật.

### Pitfall 4: `Order` entity CHƯA có cột nào của §4.5 — dễ quên bước "thêm cột" trước khi viết logic
**What goes wrong:** Bắt đầu viết `AdminOnlineOrdersService.confirm()` giả định `order.source`/`order.fulfillment_type`/`order.order_token`/`order.ship_fee`/... đã tồn tại (vì spec mô tả chúng như "đã thêm"), nhưng `apps/api/src/modules/orders/entities/order.entity.ts` (đọc trong phiên nghiên cứu này) **hoàn toàn không có** các cột này.
**Why it happens:** Spec §4.5 viết theo thì tương lai hoàn thành ("Cột thêm vào") nhưng chưa ai thi công — đây thuộc scope phase 9, không phải đã có sẵn từ phase 8.
**How to avoid:** Task đầu tiên của phase 9 (trước bất kỳ logic nghiệp vụ nào) là thêm 9 cột mới vào `Order` entity đúng §4.5 (`source DEFAULT 'STAFF'`, `fulfillment_type NULL`, `online_request_id NULL INDEX`, `order_token NULL UNIQUE`, `customer_lat/lng/map_link`, `distance_km`, `ship_fee DEFAULT 0`, `payment_method DEFAULT 'CASH'`) — additive nên an toàn với `synchronize: true`, không cần migration.
**Warning signs:** Lỗi TypeORM "column does not exist" hoặc TypeScript "Property does not exist on type Order" ngay khi viết service — nên bắt sớm ở giai đoạn compile, không phải runtime.

### Pitfall 5: `notification_outbox` chưa có entity — không thể "chỉ thêm cột dùng bảng cũ"
**What goes wrong:** Nhầm tưởng `notification_outbox` đã tồn tại (vì được nhắc nhiều trong CONTEXT/spec) và chỉ cần viết poller đọc nó.
**Why it happens:** Bảng này thuộc §4.6 spec, hoàn toàn mới — grep xác nhận trong phiên nghiên cứu này KHÔNG có entity/table nào tên `notification_outbox`/`NotificationOutbox` trong `apps/api/src/**`.
**How to avoid:** Việc đầu tiên của track "hạ tầng thông báo" là tạo entity mới đúng §4.6 (id, request_id, channel, recipient, level, status, attempts, last_error, scheduled_at, sent_at, created_at) + index `(scheduled_at, status)` cho câu quét poller.
**Warning signs:** Không có bảng → poller query lỗi ngay lần chạy đầu, dễ phát hiện; rủi ro thật là **quên** và code fake data thay vì bảng thật khi viết test.

### Pitfall 6: `SETTINGS_DEFAULTS` không tự có 4 key mới cho D-14
**What goes wrong:** Viết `AdminSettingsPage` form cho 4 ô chữ (banner đóng cửa trang khách, câu xác nhận sau submit lúc đóng cửa, v.v. — D-14) nhưng quên đăng ký key mới trong `settings.defaults.ts`, khiến `updateMany()` âm thầm bỏ qua patch (`if (!kind) continue` ở `settings.service.ts:71`) — admin bấm Lưu nhưng không gì được ghi, không có lỗi nào hiện ra.
**Why it happens:** `SettingsService.updateMany()` cố ý "bỏ qua key rác" để chống ghi key lạ — tác dụng phụ là key thật nhưng **quên khai báo** cũng bị nuốt lặng lẽ y hệt key rác.
**How to avoid:** Thêm đúng 4 (hoặc số lượng cuối cùng chốt ở plan) entry mới vào mảng `SETTINGS_DEFAULTS` (`kind: 'string'`) TRƯỚC khi viết FE — test round-trip (ghi rồi đọc lại) để bắt lỗi này sớm thay vì để QA thủ công phát hiện "sao lưu xong không thấy đổi gì".
**Warning signs:** `PUT /admin/settings` trả 200 nhưng `GET /admin/settings` sau đó không phản ánh giá trị mới — dấu hiệu chắc chắn của key chưa khai báo trong `SETTINGS_DEFAULTS`.

## Code Examples

### Đọc trạng thái công tắc hiện có (KHÔNG đổi hàm, chỉ đổi FE copy theo D-11)
```typescript
// apps/api/src/modules/public/store-status.ts (đã có, giữ nguyên logic)
// evaluateOrderingStatus() trả { enabled, is_open_now, blocking_reason } —
// D-11 chỉ đổi cách apps/shop DIỄN GIẢI `enabled === false` (không còn nghĩa
// "chặn submit", chỉ còn nghĩa "hiện banner đóng cửa + đổi câu xác nhận").
// order-guard.ts (checkOrderGuard) hiện trả ONLINE_ORDERING_DISABLED/STORE_CLOSED
// khi !ordering.enabled — ĐÂY LÀ NHÁNH PHẢI XOÁ theo D-11 (bỏ chặn 409, không xoá
// hẳn field enabled vì FE trang khách vẫn cần nó để hiện banner).
```

### Whitelist response tracking — mẫu `.strict().parse()` phải theo khi mở rộng `PublicOrderStatus`
```typescript
// packages/schemas/src/public-orders.ts — pattern hiện có (PublicOrderStatus),
// mở rộng thêm percent/stage/stage_label/cancelled_count/eta_min/eta_max/
// updated_at_ms/cancelled_note THEO ĐÚNG whitelist §6 — schema.strict() sẽ tự
// throw nếu service lỡ trả thêm field thừa (vd status từng item) — ĐÂY LÀ
// LƯỚI AN TOÀN CUỐI CÙNG cho G-1, không chỉ dựa vào code review.
export const PublicOrderStatus = z.object({
  order_token: z.string(),
  status: z.enum(['WAITING', 'CONFIRMED', 'REJECTED', 'CANCELLED_BY_CUSTOMER']),
  stage: z.enum(['RECEIVED', 'CONFIRMED', 'COOKING', 'DELIVERING', 'READY_FOR_PICKUP', 'COMPLETED', 'REJECTED']),
  stage_label: z.string(),
  percent: z.number().int().min(0).max(100),
  cancelled_count: z.number().int().nonnegative(),
  cancelled_note: z.string().nullable(),
  // ... các field đã có (fulfillment_type, items, subtotal, store_phone, reject_reason, ...)
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Công tắc "Đóng cửa" = chặn 2 lớp FE+BE (409) | Công tắc "Đóng cửa" = chỉ đổi copy, KHÔNG chặn gì | D-11 (2026-07-31, CONTEXT phase 9) | `order-guard.ts` mất 2 case (`ONLINE_ORDERING_DISABLED`, `STORE_CLOSED`), `submit-order.ts` bớt 1 nhánh throw, `CheckoutPage.tsx` đổi từ "khoá nút" sang "chỉ hiện banner" |
| Auto-OFF sau 1800s (M2.D-60) | Bỏ hẳn — không cơ chế tự đổi trạng thái | D-12 | `escalate_autooff_after_s` thành orphan setting — cần quyết định xoá hay giữ no-op |
| Chỉ role `admin` xác nhận/từ chối (M2.D-33) | Cả 3 role `admin`/`order`/`kitchen` đều duyệt được | D-02 | Route `POST .../confirm` và `.../reject` đổi guard từ `AdminGuard` sang `RequireRoles('admin','order','kitchen')`; audit log BẮT BUỘC ghi rõ actor (thay thế lớp bảo vệ role cũ) |

**Deprecated/outdated:**
- Pseudo-code spec dòng 469 (`L4 AUTOOFF scheduled_at = now + 300s`): đã stale từ M2.D-60 (ghi đè thành 1800s), và giờ **chết hẳn** theo D-12 (không còn L4 nào cả) — đừng implement theo dòng này.
- ROADMAP.md success criterion 1 hiện ghi "role `order` xem được... nhưng gọi API confirm/reject trực tiếp vẫn bị chặn" — D-02b yêu cầu sửa câu này trước khi verify, nếu không verifier sẽ đánh trượt phase dù code đúng ý chủ dự án.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Caddy tự động flush SSE mà không cần cấu hình thêm, kể cả trên bản Caddy đang dùng trong `docker-compose.prod.yml` (chưa xác minh version cụ thể trong image) | Common Pitfalls #1 | Nếu image Caddy quá cũ (trước tính năng auto-detect content-type), SSE có thể vẫn bị buffer trên production — vì C-LOCAL-01 cấm deploy production trong milestone này, rủi ro này KHÔNG chặn phase local nhưng cần re-verify khi deploy thật |
| A2 | 1 lần `.play()` thành công từ user gesture sẽ "unlock" cho mọi lần `.play()` sau trong cùng tab/session (kể cả gọi từ `setInterval`) | Pattern 4 | Nếu Safari có chính sách khác biệt với Chrome (Safari dùng "Media Engagement Index" phức tạp hơn, có thể yêu cầu gesture lặp lại trong 1 số điều kiện), banner đỏ D-03 có thể cần hiện lại nhiều lần hơn dự kiến — không phải bug, chỉ là UX cần test tay trên Safari thật trước khi coi phase xong |
| A3 | Chọn lịch cron cụ thể cho 2 job hồi sinh (`cron-audit-retention`, `cron-jti-cleanup`) — research không chốt tần suất, để nguyên planner/discretion quyết theo tinh thần "1 lần/ngày" ngụ ý trong tên "retention" | Pattern 3 | Nếu chọn tần suất quá dày (vd mỗi giờ) sẽ tốn CPU vô ích cho bảng nhỏ; quá thưa (vd mỗi tuần) làm bảng phình to hơn dự kiến giữa 2 lần chạy — rủi ro thấp, dễ chỉnh sau |

**Nếu bảng này trống:** không áp dụng — có 3 mục cần xác nhận thêm khi thi công/deploy thật.

## Open Questions

1. **`escalate_autooff_after_s` xoá hẳn hay giữ no-op (D-12 discretion)?**
   - What we know: Setting đã tồn tại trong `SETTINGS_DEFAULTS` (`settings.defaults.ts:36`) và `StoreSettingsMap` type; không có code nào khác đọc riêng key này ngoài khu vực bị bỏ (auto-OFF logic chưa từng được viết — chỉ mới ở dạng setting placeholder).
   - What's unclear: Xoá hẳn key + field UI liên quan có làm vỡ gì ở `AdminSettingsPage.tsx` không (grep hiện tại không thấy field này render ở đó — cần xác nhận lại lúc thi công vì trang này có thể đã thêm field cho nó ở phase 8 mà research chưa đọc hết toàn bộ file).
   - Recommendation: Planner nên đọc toàn bộ `AdminSettingsPage.tsx` (chỉ đọc 100 dòng đầu trong research này) trước khi quyết định xoá vs no-op, để biết chắc UI có field này hay chưa.

2. **Global bell (`NotificationBell.tsx`) có cần biết về đơn online chờ duyệt không, hay badge D-05 chỉ nằm trong `OnlineOrdersQueuePage`?**
   - What we know: `NotificationBell.tsx` hiện dùng `notificationStore` (client-side, nạp từ polling diff của `ready-notifier.ts`), hoàn toàn tách biệt khỏi SSE mới. Spec §8 nói "Dashboard hiện có: thêm badge đơn chờ duyệt" — ngụ ý có 1 nơi NGOÀI trang queue cũng cần thấy badge.
   - What's unclear: CONTEXT.md D-05 chỉ nói "kèm badge số đơn chờ" trong ngữ cảnh trang `OnlineOrdersQueuePage`, không nói rõ badge đó phải lộ ra Dashboard/nav toàn cục.
   - Recommendation: Coi đây là Claude's Discretion khi lên plan — badge tối thiểu (bắt buộc theo D-05) nằm trong trang queue; badge ở Dashboard là "nice to have" theo tinh thần spec §8 nhưng không phải success criterion đã LOCKED, planner có thể để P2/optional.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| MySQL local | Test integration (row lock cấp bàn, doanh thu) | ✓ (xác nhận qua `open-order-lock.integration.test.ts` chạy được ở phase 8 theo STATE.md "18/18 xanh") | 8.x (container/native, cổng theo `.env`) | Không có fallback — C-TEST-01 bắt buộc MySQL thật, test phải fail rõ ràng nếu thiếu (đã có pattern throw lỗi rõ trong `beforeAll`) |
| `@nestjs/schedule` | Poller outbox + 2 cron hồi sinh (D-19) | ✗ (chưa có trong `apps/api/package.json`) | 6.1.3 xác nhận khả dụng qua npm registry | Không cần fallback — cài trực tiếp, đã qua legitimacy gate |
| `pnpm` | Cài package mới, chạy test/build | ✗ HỎNG trên máy này (Node 20 vs `node:sqlite`) | — | Dùng binary trực tiếp: `apps/api/node_modules/.bin/vitest run`, `apps/api/node_modules/.bin/tsc --noEmit`, `apps/shop/node_modules/.bin/vite build` (đã xác nhận cả 3 tồn tại và chạy được trong phiên nghiên cứu này) |
| Docker / `caddy` CLI | Xác minh Caddy buffering thật (ngoài đọc doc) | ✗ (đã ghi nhận từ phase 7/8 — máy dev không có) | — | Dựa vào tài liệu chính thức Caddy (Pitfall #1) thay vì test thật; xác nhận lại khi deploy (ngoài phạm vi C-LOCAL-01) |

**Missing dependencies with no fallback:** none (MySQL đã có sẵn và chạy được)
**Missing dependencies with fallback:** `pnpm` (dùng binary trực tiếp), `@nestjs/schedule` (cài mới, không phải fallback mà là việc cần làm), Docker/caddy CLI (dựa vào doc chính thức)

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^2.1.0 (đã cấu hình ở `apps/api`, không có `vitest.config.ts` — chạy trên default Node environment) |
| Config file | none — mặc định Vitest |
| Quick run command | `cd apps/api && ./node_modules/.bin/vitest run src/modules/public/order-guard.test.ts` (ví dụ 1 file thuần, không cần MySQL) |
| Full suite command | `cd apps/api && ./node_modules/.bin/vitest run` (bao gồm integration test cần MySQL sống — xem Environment Availability) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REQ-M | Cấp bàn row lock, 2 admin song song không trùng bàn | integration (2 MySQL connection thật) | `./node_modules/.bin/vitest run src/modules/admin-online-orders/admin-online-orders.integration.test.ts` | ❌ Wave 0 — viết mới theo khuôn `open-order-lock.integration.test.ts` |
| REQ-M | Đơn WAITING không lẫn vào doanh thu/bếp/sơ đồ bàn | integration (đếm doanh thu trước/sau 5 đơn WAITING) | cùng file trên, thêm `describe` riêng | ❌ Wave 0 |
| REQ-M | Role order/kitchen duyệt được (D-02), audit log ghi rõ actor | unit (guard) + integration (audit row) | `./node_modules/.bin/vitest run src/modules/admin-online-orders/*.test.ts` | ❌ Wave 0 |
| REQ-N | Poller outbox quét đúng `scheduled_at <= now AND status=PENDING` | unit (hàm thuần chọn hàng) + integration (bảng thật) | `./node_modules/.bin/vitest run src/modules/notifications/*.test.ts` | ❌ Wave 0 |
| REQ-N | SMS_DRIVER console/esms không đổi logic gọi | unit (interface `SmsChannel`, 2 implementation cùng contract test) | `./node_modules/.bin/vitest run src/modules/notifications/channels/*.test.ts` | ❌ Wave 0 |
| REQ-O | `computeProgress()` đúng công thức §6, đơn điệu, chặn 95% | unit (hàm thuần, đã có mẫu ở `order-guard.test.ts`/`store-status.test.ts`) | `./node_modules/.bin/vitest run src/modules/public/order-progress.test.ts` | ❌ Wave 0 |
| REQ-O | Response `/api/public/orders/:token` không chứa status từng item | unit (assert `Object.keys` không có field cấm) — đã có tiền lệ ở `public-menu-shape.test.ts` cho pattern tương tự | `./node_modules/.bin/vitest run src/modules/public/public-orders.test.ts` | ⚠ file `public-orders.test.ts` ĐÃ TỒN TẠI (phase 8) — mở rộng, không tạo mới |

### Sampling Rate
- **Per task commit:** chạy riêng file test vừa sửa (`vitest run <file>`)
- **Per wave merge:** `./node_modules/.bin/vitest run` toàn bộ `apps/api` (bao gồm integration — cần MySQL sống)
- **Phase gate:** Full suite xanh + `sh scripts/check-shop-bundle.sh` (OK) trước `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `apps/api/src/modules/admin-online-orders/admin-online-orders.integration.test.ts` — covers REQ-M (row lock + doanh thu)
- [ ] `apps/api/src/modules/notifications/*.test.ts` — covers REQ-N (outbox poller + SMS driver contract)
- [ ] `apps/api/src/modules/public/order-progress.test.ts` — covers REQ-O (công thức %)
- [ ] Framework install: `pnpm --filter @order/api add @nestjs/schedule@6.1.3` (hoặc tương đương thủ công do `pnpm` hỏng trên máy này)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | yes (route admin) | `JwtAuthGuard` đã có, không đổi |
| V3 Session Management | yes | Cookie httpOnly + SameSite=Strict đã có; SSE stream dùng cùng cookie, không có session riêng |
| V4 Access Control | yes | `RequireRoles('admin','order','kitchen')` cho GET+confirm+reject (D-02 ghi đè M2.D-33) — audit log actor là kiểm soát bù trừ bắt buộc |
| V5 Input Validation | yes | Zod `.strict()` cho mọi response public mới; `reject_reason` chỉ nhận 1 trong ~5 giá trị soạn sẵn (D-08) — validate bằng `z.enum(...)`, KHÔNG nhận free text vào field public |
| V6 Cryptography | no (không có mã hoá mới trong phase này) | — |

### Known Threat Patterns for stack này

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Ghi chú nội bộ (D-09, free text) vô tình lọt vào response public `/o/:token` | Information Disclosure | Whitelist tường minh bằng `.strict().parse()` ở `PublicOrderStatus` — chỉ `reject_reason` (enum soạn sẵn) đi ra, field ghi chú nội bộ KHÔNG có mặt trong schema public, dù DB có lưu |
| Actor giả mạo trong audit log khi 3 role đều duyệt được | Repudiation | `reviewed_by_user_id`/`reviewed_by_full_name` lấy từ `req.user` (đã qua `JwtAuthGuard`, không tin body request) — pattern đã có sẵn ở `Order.created_by_*`/`checked_out_by_*` |
| CSRF trên endpoint `POST /admin/online-orders/:id/confirm|reject` | Tampering | Tự động phủ bởi `pathRequiresCheck()` hiện có (`path.startsWith('/admin/')` → true) — KHÔNG cần sửa gì ở `csrf-paths.ts` |
| SSE endpoint bị lợi dụng để giữ connection vô hạn, DoS nhẹ | Denial of Service | Heartbeat + `takeUntil(close$)` dọn subscriber khi client ngắt (Pattern 1); giới hạn số connection đồng thời không cần thiết ở quy mô 1 quán nhỏ (vài tab admin), nhưng nên log số subscriber hiện tại để phát hiện leak |

## Sources

### Primary (HIGH confidence)
- [NestJS official docs — Server-Sent Events](https://docs.nestjs.com/techniques/server-sent-events) — xác nhận `@Sse()` yêu cầu return `Observable`, headers chuẩn
- [NestJS official docs — Task Scheduling](https://docs.nestjs.com/techniques/task-scheduling) — `@Cron()` decorator, `ScheduleModule.forRoot()`
- [Caddy — reverse_proxy directive docs](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) — xác nhận auto-flush cho `text/event-stream`, qua WebFetch trong phiên này
- `npm view @nestjs/schedule version` + `peerDependencies` — chạy trực tiếp trong phiên nghiên cứu này, kết quả 6.1.3, tương thích Nest 10
- `slopcheck install @nestjs/schedule` — chạy trực tiếp, verdict `[OK]`
- Đọc trực tiếp mã nguồn: `apps/api/src/modules/public/{order-guard,store-status,submit-order,public-orders.service,public-orders.controller}.ts`, `apps/api/src/modules/public/entities/online-order-request.entity.ts`, `apps/api/src/modules/orders/entities/order.entity.ts`, `apps/api/src/modules/orders/orders.service.ts` (dòng 183-288), `apps/api/src/modules/tables/{entities/restaurant-table.entity.ts,tables.controller.ts}`, `apps/api/src/modules/settings/{settings.service.ts,settings.defaults.ts}`, `apps/api/src/modules/audit/audit.interceptor.ts`, `apps/api/src/app.module.ts`, `apps/api/src/main.ts`, `apps/api/src/common/{middleware/csrf-origin.middleware.ts,csrf-paths.ts}`, `apps/web/src/App.tsx`, `apps/web/src/pages/AdminSettingsPage.tsx`, `apps/web/src/components/NotificationBell.tsx`, `apps/shop/src/pages/{CheckoutPage,OrderTrackPage}.tsx`, `packages/schemas/src/{errors.ts,public-orders.ts}`, `scripts/check-shop-bundle.sh`

### Secondary (MEDIUM confidence)
- [Chrome for Developers — Autoplay policy in Chrome](https://developer.chrome.com/blog/autoplay) — `NotAllowedError`, user activation model
- [MDN — HTMLMediaElement.play()](https://developer.mozilla.org/docs/Web/API/HTMLMediaElement/play) — cross-check hành vi reject promise
- `sh scripts/check-shop-bundle.sh` chạy thật trong phiên này sau `vite build` tại `apps/shop` — kết quả đo được: **352 kB / 370 kB** (18 kB dư, ~4.9%)

### Tertiary (LOW confidence)
- Không có — mọi claim quan trọng đều verify qua tool trong phiên này hoặc đọc trực tiếp code/doc chính thức.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — `@nestjs/event-emitter` đã chạy production trong repo, `@nestjs/schedule` xác minh version+peer-dep qua npm thật
- Architecture: MEDIUM-HIGH — pattern SSE/cron xác nhận qua doc chính thức + code tương tự trong repo; phần "cấp bàn row lock" HIGH vì có tiền lệ y hệt (open-order-lock test)
- Pitfalls: HIGH — 6/6 pitfall xác nhận trực tiếp bằng đọc code hiện tại (grep/Read), không suy đoán
- Security: MEDIUM — dựa trên pattern ASVS chuẩn + review code guard hiện có, không chạy pentest thật

**Research date:** 2026-07-31
**Valid until:** ~14 ngày (phase có nhiều phần phụ thuộc code đang biến động nhanh — phase 8 vừa xong, `AdminSettingsPage.tsx`/settings module có thể đổi trước khi phase 9 thi công xong)
