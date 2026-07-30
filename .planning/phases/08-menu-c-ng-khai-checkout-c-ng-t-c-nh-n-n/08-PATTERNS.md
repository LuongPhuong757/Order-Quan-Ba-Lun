# Phase 8: Menu công khai, Checkout & Công tắc nhận đơn - Pattern Map

**Mapped:** 2026-07-30
**Files analyzed:** 33 (file mới + file sửa, 3 app + packages/schemas)
**Analogs found:** 29 / 33 (4 "không có analog thật" — ghi rõ lý do trong mục riêng)

---

## File Classification

### apps/api

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `apps/api/src/modules/public/store.controller.ts` (hoặc thêm route vào `public.controller.ts`) | controller | request-response | `apps/api/src/modules/public/public.controller.ts` | exact (docblock bắt buộc dùng lại) |
| `apps/api/src/modules/public/menu.controller.ts` (public menu route) | controller | request-response, CRUD-read | `apps/api/src/modules/public/public.controller.ts` + `apps/api/src/modules/menu/menu.controller.ts` (GET list) | role-match |
| `apps/api/src/modules/public/orders.controller.ts` (`POST /api/public/orders`, `GET /api/public/orders/:token`) | controller | request-response + transaction | `apps/api/src/modules/menu/menu.controller.ts` (`toggleStock` — transaction trong controller) | role-match |
| `apps/api/src/modules/public/store-status.ts` | utility (pure fn) | transform | `apps/api/src/common/origin-allowlist.ts` | exact |
| `apps/api/src/modules/public/store-status.test.ts` | test | — | `apps/api/src/common/origin-allowlist.test.ts` | exact (mẫu test DUY NHẤT) |
| `apps/api/src/modules/public/order-guard.ts` | utility (pure fn) | transform | `apps/api/src/common/origin-allowlist.ts` | exact |
| `apps/api/src/modules/public/order-guard.test.ts` | test | — | `apps/api/src/common/origin-allowlist.test.ts` | exact |
| `apps/api/src/modules/public/haversine.ts` | utility (pure fn) | transform | `apps/api/src/common/origin-allowlist.ts` | exact |
| `apps/api/src/modules/public/haversine.test.ts` | test | — | `apps/api/src/common/origin-allowlist.test.ts` | exact |
| `apps/api/src/modules/public/ip-hash.ts` | utility (pure fn) | transform | `apps/api/src/common/origin-allowlist.ts` | exact |
| `apps/api/src/modules/public/ip-hash.test.ts` | test | — | `apps/api/src/common/origin-allowlist.test.ts` | exact |
| `apps/api/src/modules/settings/entities/store-settings.entity.ts` | model (entity) | CRUD | `apps/api/src/modules/menu/entities/menu-item.entity.ts` | exact |
| `apps/api/src/modules/public/entities/online-order-request.entity.ts` | model (entity) | CRUD | `apps/api/src/modules/orders/entities/order.entity.ts` | exact |
| `apps/api/src/modules/settings/entities/phone-blacklist.entity.ts` | model (entity) | CRUD | `apps/api/src/modules/menu/entities/menu-item.entity.ts` | role-match |
| `apps/api/src/common/middleware/csrf-origin.middleware.ts` (SỬA, không tạo mới) | middleware | request-response | chính nó — mở rộng `pathRequiresCheck()` | exact (đọc lại chính file) |
| `apps/api/src/app.module.ts` (SỬA — thêm module mới) | config | — | chính nó | exact |
| `apps/api/src/modules/menu/menu.controller.ts` (SỬA — thêm bước `sharp` resize trong `uploadImage`) | controller | file-I/O | chính nó (đã có `diskStorage`/`randomBytes`) | exact |
| `apps/api/src/modules/settings/settings.controller.ts` (`GET`/`PUT` `/admin/settings`) | controller | CRUD | `apps/api/src/modules/admin/users.controller.ts` | exact |
| `apps/api/src/modules/settings/phone-blacklist.controller.ts` (`POST`/`DELETE`/`GET` `/admin/phone-blacklist`) | controller | CRUD | `apps/api/src/modules/admin/users.controller.ts` | exact |
| `apps/api/src/modules/audit/audit.interceptor.ts` (SỬA — thêm nhánh `deriveActionKind` + `extractTargetKind`) | middleware/utility | event-driven | chính nó | exact |
| `packages/schemas/src/public-store.ts` | model (schema) | transform | `packages/schemas/src/menu.ts` | exact |
| `packages/schemas/src/public-menu.ts` | model (schema) | transform | `packages/schemas/src/menu.ts` | exact |
| `packages/schemas/src/public-orders.ts` | model (schema) | transform | `packages/schemas/src/orders.ts` | exact |
| `packages/schemas/src/errors.ts` (SỬA — thêm 9 code mới vào `ErrorCode` enum) | model (schema) | transform | chính nó | exact |

### apps/shop

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `apps/shop/src/main.tsx` (SỬA) | config/provider | — | chính nó (thay `<BrandPreview/>` bằng `BrowserRouter`); router mẫu ở `apps/web/src/App.tsx` | role-match |
| `apps/shop/src/App.tsx` (mới, hoặc route khai thẳng trong `main.tsx`) | route/provider | — | `apps/web/src/App.tsx` (cách khai `Routes`/`Route`/`Outlet`, KHÔNG copy phần auth/RoleGate) | partial (chỉ mượn cấu trúc Routes, bỏ auth) |
| `apps/shop/src/components/AppShell.tsx` | component | — | `apps/shop/src/components/Wordmark.tsx` (style convention) | role-match (không có AppShell có sẵn) |
| `apps/shop/src/components/Header.tsx` (2 biến thể CSS) | component | — | `apps/shop/src/components/Wordmark.tsx` | role-match |
| `apps/shop/src/components/CategoryRail.tsx` | component | — | `apps/shop/src/components/Wordmark.tsx` | role-match |
| `apps/shop/src/components/BannerNotice.tsx` | component | — | `apps/shop/src/components/Wordmark.tsx` | role-match |
| `apps/shop/src/components/CardItem.tsx` | component | — | `apps/shop/src/components/Wordmark.tsx` | role-match |
| `apps/shop/src/lib/use-api.ts` | hook | request-response | **không có analog thật** — xem "Không có analog" | none |
| `apps/shop/src/lib/customer-token.ts` | utility | — | không cần analog — 100% mới, đơn giản (`crypto.randomUUID`) | none (trivial) |
| `apps/shop/src/lib/cart-store.ts` | store (localStorage) | CRUD (client-side) | **không có analog thật** — xem "Không có analog" | none |
| `apps/shop/src/pages/MenuPage.tsx` | component | request-response | `apps/shop/src/pages/CartPage.tsx` (placeholder hiện có — điền ruột, giữ page-level style const) | role-match |
| `apps/shop/src/pages/CartPage.tsx` (SỬA — điền ruột) | component | CRUD (client-side) | chính nó (placeholder) | exact |
| `apps/shop/src/pages/CheckoutPage.tsx` (SỬA — điền ruột) | component | request-response | chính nó (placeholder) | exact |
| `apps/shop/src/pages/HistoryPage.tsx` (SỬA — thêm empty state thật) | component | — | chính nó (placeholder) | exact |
| `apps/shop/src/pages/OrderTrackPage.tsx` (SỬA — màn xác nhận tối giản) | component | request-response | chính nó (placeholder) | exact |

### apps/web

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `apps/web/src/pages/AdminSettingsPage.tsx` | component | CRUD | `apps/web/src/pages/AdminUsersPage.tsx` (form/modal + table pattern) VÀ `apps/web/src/pages/AdminAuditPage.tsx` (bộ lọc qua `useSearchParams` — dùng cho tab blacklist) | exact |
| `apps/web/src/App.tsx` (SỬA — thêm `<Route path="/admin/settings">`, dòng ~58-63) | route | — | chính nó | exact |
| `apps/web/src/pages/DashboardPage.tsx` (SỬA — thêm widget switch) | component | request-response | chính nó (card link pattern có sẵn) | exact |
| `apps/web/src/pages/MenuManagementPage.tsx` (KHÔNG sửa UI, chỉ biết context D-12 resize xảy ra ở BE) | component | file-I/O | chính nó (dòng ~572-601 `handleFile`) | exact (không sửa, chỉ tham chiếu) |

---

## Pattern Assignments

### apps/api — Public controller (`store.controller.ts` / `menu.controller.ts` / `orders.controller.ts` dưới `/api/public/*`)

**Analog:** `apps/api/src/modules/public/public.controller.ts`

**Imports + response envelope pattern** (toàn file, 65 dòng):
```typescript
import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { apiOk, type ApiOk } from '@order/utils';

@Controller('api/public')
export class PublicController {
  @Get('health')
  async health(): Promise<ApiOk<PublicHealth>> {
    // ...
    return apiOk<PublicHealth>({ ... });
  }
}
```

**Bắt buộc theo docblock trong chính file này (dòng 6-26):**
- success = `apiOk()` từ `@order/utils`
- error = **giữ nguyên shape compact** của `GlobalExceptionFilter` (KHÔNG tự tạo response shape khác)
- `@Controller('api/public')` — không `setGlobalPrefix`, đường dẫn khai ở decorator là đầy đủ
- Không cần `@Throttle` cho GET (health/menu/store) vì throttler `default` toàn cục (600/phút/IP) đã áp — chỉ `POST /api/public/orders` cần `@Throttle` riêng (xem "Rate limit endpoint submit" bên dưới)

**Error throw pattern** (theo Pitfall #6 của RESEARCH — KHÔNG thêm code vào `FRIENDLY_VN`, build message tại chỗ):
```typescript
throw new ConflictException({
  code: 'ONLINE_ORDERING_DISABLED',
  message: offReason
    ? `Quán vừa tắt nhận đơn online. ${offReason}`
    : `Quán vừa tắt nhận đơn online. Vui lòng gọi ${storePhone} để đặt trực tiếp.`,
});
```

---

### apps/api — Transaction pattern trong controller (submit đơn + gap lock)

**Analog:** `apps/api/src/modules/menu/menu.controller.ts` — method `toggleStock` (dòng 296-357)

**Core pattern** (transaction qua `DataSource.transaction`, lấy repo qua `mgr`, raw query builder khi cần):
```typescript
@Post(':id/toggle-stock')
@UseGuards(JwtAuthGuard)
async toggleStock(@Param('id') id: string, @Req() req: Request) {
  return await this.ds.transaction(async (mgr) => {
    const menuRepo = mgr.getRepository(MenuItem);
    const item = await menuRepo.findOne({ where: { id } });
    if (!item) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Món không tồn tại' });
    // ... mutate, save, raw update qua mgr.createQueryBuilder()...update()...
  });
}
```
Áp dụng cho `POST /api/public/orders`: thay `mgr.getRepository(MenuItem).findOne` bằng raw `SELECT ... FOR UPDATE` (gap lock, xem RESEARCH Pattern 3) trong CÙNG transaction trước khi insert `online_order_requests`.

---

### apps/api — CSRF guard mở rộng (`pathRequiresCheck`)

**Analog:** chính `apps/api/src/common/middleware/csrf-origin.middleware.ts` (SỬA, không viết mới)

**Vị trí sửa** (dòng 21-31):
```typescript
function pathRequiresCheck(path: string): boolean {
  // Mutations on /admin/* and /auth/* (except login + setup which need to work pre-auth)
  if (path.startsWith('/admin/')) return true;
  if (path.startsWith('/auth/')) {
    if (path === '/auth/login' || path === '/auth/recover') return false;
    return true;
  }
  return false;
}
```
**Thêm nhánh** (theo RESEARCH Pitfall #1): `if (path.startsWith('/api/public/')) return true;` — chỉ ảnh hưởng method trong `MUTATION_METHODS` (đã lọc ở `use()` dòng 36), nên GET `/api/public/menu`/`/store` không bị chặn oan.

---

### apps/api — Rate limit riêng endpoint submit (`@Throttle`)

**Analog:** `apps/api/src/modules/auth/auth.controller.ts` (dòng 1-31, method `login`)

**Import + decorator pattern:**
```typescript
import { Throttle } from '@nestjs/throttler';

@Post('login')
@HttpCode(200)
@Throttle({ default: { limit: 5, ttl: 300_000 } })
async login(@Body() dto: LoginDto, ...) { ... }
```
Áp cho `POST /api/public/orders`: `@Throttle({ default: { limit: 10, ttl: 60_000 } })` (đề xuất RESEARCH: 10 req/phút/IP riêng cho endpoint này — số cụ thể là Open Question, planner/executor tự chốt theo mặc định đề xuất). Global `default` (600/phút, khai ở `app.module.ts` dòng 27-29) vẫn áp song song, không cần đổi.

---

### apps/api — Pure function + test (store-status, order-guard, haversine, ip-hash)

**Analog:** `apps/api/src/common/origin-allowlist.ts` + `apps/api/src/common/origin-allowlist.test.ts` — **mẫu test DUY NHẤT trong repo**

**Convention file thuần** (đầu file — comment giải thích lý do là hàm thuần, không import Nest/DB):
```typescript
// Module thuần: không import gì từ @nestjs/* hay express, để test được mà không dựng app.

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

export function isOriginAllowed(originOrReferer: string | undefined, allowed: string[]): boolean {
  if (!originOrReferer) return false;
  // ...
}
```

**Convention test** (vitest zero-config, `describe`/`it` tiếng Việt, import `.js` extension dù file `.ts` — ESM pure):
```typescript
import { describe, expect, it } from 'vitest';
import { isOriginAllowed, parseAllowedOrigins } from './origin-allowlist.js';

describe('isOriginAllowed — chặn prefix-spoofing (C-SEC-01)', () => {
  it('CHẶN origin gắn thêm hậu tố tên miền', () => {
    expect(isOriginAllowed('https://quanbalun.site.evil.com', PROD)).toBe(false);
  });
});
```
**Áp dụng cho 4 file mới:** `store-status.ts`/`order-guard.ts`/`haversine.ts`/`ip-hash.ts` đều theo đúng khuôn: export hàm thuần, comment nguồn quyết định (M2.D-xx) ở đầu file, file test cặp đôi cùng thư mục, không import DataSource/Nest. RESEARCH đã cho sẵn code mẫu đầy đủ cho cả 4 hàm này (`evaluateOrderingStatus`, `checkOrderGuard`, `haversineKm`, `hashIp`) trong `08-RESEARCH.md` mục "Code Examples"/"Pattern 1/2/3" — copy trực tiếp, không cần viết lại từ đầu.

---

### apps/api — Entity mới (settings, online_order_requests, phone_blacklist)

**Analog:** `apps/api/src/modules/menu/entities/menu-item.entity.ts` (entity đơn giản) + `apps/api/src/modules/orders/entities/order.entity.ts` (entity có nhiều cột nullable + index)

**Import + decorator pattern chuẩn:**
```typescript
import {
  Column, CreateDateColumn, Entity, Index,
  PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';

@Entity('menu_items')
@Index('idx_menu_active_group', ['is_active', 'group'])
export class MenuItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'int', unsigned: true })
  price!: number;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;
}
```
**Bắt buộc:** MỌI cột datetime dùng `dateToMsTransformer` (import từ `../../auth/entities/user.entity.js` — đúng đường dẫn tương đối theo vị trí entity mới, điều chỉnh số `../` cho khớp thư mục). Với `synchronize: true` (C-SCHEMA-07): thêm cột/bảng mới an toàn qua decorator, **không rename cột** (mất dữ liệu im lặng). `online_order_requests` nên thêm composite index `@Index(['customer_phone', 'status'])` (RESEARCH Pattern 3 khuyến nghị) song song với unique index kiểu `idx_menu_code` (dòng 12 của `menu-item.entity.ts`) nếu cần unique riêng lẻ nào.

---

### apps/api — Upload ảnh + resize (D-12, chèn `sharp` vào flow có sẵn)

**Analog:** chính `apps/api/src/modules/menu/menu.controller.ts` (dòng 1-38, 143-169)

**Điểm chèn — giữ nguyên toàn bộ khung, chỉ thêm bước xử lý buffer trước khi ghi/sau khi ghi:**
```typescript
const UPLOAD_DIR = 'uploads/menu';
const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB
mkdirSync(UPLOAD_DIR, { recursive: true });

@Post('upload-image')
@UseGuards(AdminGuard)
@UseInterceptors(
  FileInterceptor('file', {
    storage: diskStorage({
      destination: UPLOAD_DIR,
      filename: (_req, file, cb) => {
        const ext = extname(file.originalname).toLowerCase() || '.jpg';
        const safe = ext.replace(/[^a-z0-9.]/g, '');
        const name = `${Date.now()}-${randomBytes(6).toString('hex')}${safe}`;
        cb(null, name);
      },
    }),
    limits: { fileSize: MAX_FILE_BYTES },
    fileFilter: (_req, file, cb) => {
      if (!ALLOWED_MIMES.has(file.mimetype)) {
        cb(new BadRequestException({ code: 'BAD_REQUEST', message: 'Chỉ chấp nhận ảnh JPG/PNG/WEBP/GIF' }), false);
        return;
      }
      cb(null, true);
    },
  }),
)
async uploadImage(@UploadedFile() file: Express.Multer.File) {
  if (!file) throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Thiếu file ảnh' });
  return { data: { url: `/uploads/menu/${file.filename}` } };
}
```
**Giữ nguyên:** tên biến `UPLOAD_DIR`, `ALLOWED_MIMES`, `MAX_FILE_BYTES`, cách đặt tên file bằng `randomBytes(6).toString('hex')` (an toàn path-traversal, ASVS V12 đã ghi trong RESEARCH). **Thêm mới:** sau `FileInterceptor` ghi file gốc (hoặc chuyển `diskStorage` → `memoryStorage` để xử lý buffer trong RAM trước khi ghi — quyết định cụ thể của executor, xem RESEARCH ASVS V12), gọi `sharp(buffer).resize(800).webp().toFile(...)` trước khi trả `url`. Đổi phần mở rộng file đầu ra thành `.webp` bất kể mime gốc.

---

### apps/api — Controller admin mới (`/admin/settings`, `/admin/phone-blacklist`)

**Analog:** `apps/api/src/modules/admin/users.controller.ts` (toàn file — DTO + guard + CRUD pattern)

**Import + guard + DTO pattern:**
```typescript
import { IsIn, IsOptional, IsString, MinLength, MaxLength } from 'class-validator';
import { AdminGuard } from '../auth/guards/admin.guard.js';

class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(128) full_name?: string;
  @IsOptional() @IsIn(ROLE_VALUES) role?: Role;
}

@Controller('admin/users')
@UseGuards(AdminGuard)
export class AdminUsersController {
  constructor(@InjectRepository(User) private readonly userRepo: Repository<User>) {}

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException({ code: 'NOT_FOUND', message: 'User not found' });
    // ...
    return { data: { ... } };
  }
}
```
**Prefix route:** theo RESEARCH Pitfall #2 — dùng `@Controller('admin/settings')` **KHÔNG** `/api/admin/settings` dù spec §5.2 ghi có `/api`; khớp convention thật của `admin/users`, `admin/audit`. Ghi 1 dòng vào `OVERRIDE-DEBT.md` (lệch chữ spec, không lệch hành vi).

**`@UseGuards(AdminGuard)` đặt ở class-level** (dòng 54-55 của file gốc) — áp cho toàn bộ route trong controller, không cần lặp lại từng method.

---

### apps/api — Audit interceptor mở rộng (`deriveActionKind`, `extractTargetKind`)

**Analog:** chính `apps/api/src/modules/audit/audit.interceptor.ts` (SỬA, không viết mới)

**Vị trí sửa 1 — `deriveActionKind()`** (dòng 19-65, if-chain thủ công match `path`+`method`):
```typescript
// Admin / users
if (path === '/admin/users' && method === 'POST') return 'admin.user_created';
if (path.match(/^\/admin\/users\/[^/]+\/reset-password$/)) return 'admin.password_reset';
```
**Thêm nhánh mới trước dòng `return \`${method.toLowerCase()}.${path...}\`;`** (dòng 64):
```typescript
if (path === '/admin/settings' && method === 'PUT') return 'settings.updated';
if (path === '/admin/phone-blacklist' && method === 'POST') return 'phone_blacklist.added';
if (path.match(/^\/admin\/phone-blacklist\/[^/]+$/) && method === 'DELETE') return 'phone_blacklist.removed';
```

**Vị trí sửa 2 — `extractTargetKind()`** (dòng 125-131):
```typescript
function extractTargetKind(path: string): string | null {
  if (path.startsWith('/auth/')) return 'auth';
  if (path.startsWith('/admin/users')) return 'user';
  if (path.startsWith('/admin/audit')) return 'audit';
  if (path.startsWith('/setup')) return 'setup';
  return null;
}
```
Thêm `if (path.startsWith('/admin/settings')) return 'settings';` và `if (path.startsWith('/admin/phone-blacklist')) return 'phone_blacklist';`.

**Interceptor đã đăng ký global** ở `app.module.ts` dòng 45 (`{ provide: APP_INTERCEPTOR, useClass: AuditInterceptor }`) — controller mới KHÔNG cần tự khai báo lại, chỉ cần route match if-chain trên để có tên đẹp (nếu không match, vẫn ghi log nhưng tên xấu — không phải lỗi chức năng, theo Pitfall #3 RESEARCH).

---

### apps/api — app.module.ts (đăng ký module mới)

**Analog:** chính file, xem cách `PublicModule`/`MenuModule` được add vào mảng `imports` (dòng 11-41). Thêm `SettingsModule` (hoặc gộp vào `AdminModule`/`PublicModule` tuỳ cách chia — Claude's Discretion theo CONTEXT.md) vào cùng vị trí, giữ nguyên comment style giải thích lý do đặt module (xem comment dòng 24-29, 37-40 làm mẫu).

---

### packages/schemas — Domain schema file mới (`public-store.ts`, `public-menu.ts`, `public-orders.ts`)

**Analog:** `packages/schemas/src/menu.ts` (toàn file, 32 dòng) + `packages/schemas/src/orders.ts` (DTO có refine-style validation dùng `z.object` + phần constants VN label đi kèm)

**Convention 1 file/domain, `z.object` + `z.infer` cùng chỗ:**
```typescript
import { z } from 'zod';

export const MenuGroup = z.enum(['food', 'drink', 'side', 'other']);
export type MenuGroup = z.infer<typeof MenuGroup>;

export const MenuItem = z.object({
  id: z.string().uuid(),
  code: z.string(),
  price: z.number().int().nonnegative(),
  image_url: z.string().nullable(),
});
export type MenuItem = z.infer<typeof MenuItem>;

export const CreateMenuItemDto = z.object({
  code: z.string().min(1).max(32),
  price: z.number().int().nonnegative().max(100_000_000),
});
export type CreateMenuItemDto = z.infer<typeof CreateMenuItemDto>;
```
**Thêm barrel export** vào `packages/schemas/src/index.ts` (đang là 6 dòng `export * from './xxx.js'`):
```typescript
export * from './errors.js';
export * from './menu.js';
export * from './orders.js';
```
→ thêm `export * from './public-store.js';`, `export * from './public-menu.js';`, `export * from './public-orders.js';`.

**RESEARCH đã viết sẵn nội dung đầy đủ cho `public-menu.ts` và `public-orders.ts`** (mục "Code Examples" và "Pattern 4") — bao gồm `.strict()` + `.refine()` cho PICKUP/DELIVERY — copy trực tiếp từ đó, chỉ cần đối chiếu convention import/export ở trên.

**Sửa `errors.ts`** (dòng 5-24, thêm vào enum, giữ nguyên comment style dòng 1-2):
```typescript
export const ErrorCode = z.enum([
  // ...existing...
  'ONLINE_ORDERING_DISABLED',
  'STORE_CLOSED',
  'PHONE_BLACKLISTED',
  'TOO_MANY_REQUESTS',
  'ORDER_ALREADY_OPEN_FOR_PHONE',
  'ORDER_ALREADY_CONFIRMED',
  'ORDER_TOKEN_NOT_FOUND',
  'MENU_ITEM_UNAVAILABLE',
  'NO_TABLE_AVAILABLE',
]);
```

---

### apps/shop — main.tsx (router + AppShell mount)

**Analog:** chính file (SỬA) + cấu trúc `Routes`/`Route` mượn từ `apps/web/src/App.tsx` (dòng 1, 21-72 — **chỉ mượn cú pháp khai route, KHÔNG mượn `AuthProvider`/`RoleGate`/`ProtectedShell`** vì `apps/shop` không có auth)

**Hiện trạng cần thay** (toàn bộ `main.tsx`, 22 dòng):
```typescript
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/fonts.css';
import './styles/tokens.css';
import { BrandPreview } from './BrandPreview.tsx';

createRoot(root).render(
  <StrictMode>
    <BrandPreview />
  </StrictMode>,
);
```
**Thay bằng** (cấu trúc mượn từ `apps/web/src/App.tsx` dòng 1 + 28):
```typescript
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './styles/fonts.css';
import './styles/tokens.css';
import { AppShell } from './components/AppShell.tsx';
import { MenuPage } from './pages/MenuPage.tsx';
import { CartPage } from './pages/CartPage.tsx';
import { CheckoutPage } from './pages/CheckoutPage.tsx';
import { OrderTrackPage } from './pages/OrderTrackPage.tsx';
import { HistoryPage } from './pages/HistoryPage.tsx';

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<MenuPage />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/checkout" element={<CheckoutPage />} />
          <Route path="/o/:token" element={<OrderTrackPage />} />
          <Route path="/history" element={<HistoryPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
```
Bỏ import `BrandPreview` khỏi điểm mount (giữ file `BrandPreview.tsx` để tham khảo màu, theo CONTEXT.md Integration Points).

---

### apps/shop — Component style convention (Header, AppShell, CategoryRail, BannerNotice, CardItem)

**Analog:** `apps/shop/src/components/Wordmark.tsx` (toàn file, 89 dòng) — **khuôn mẫu BẮT BUỘC cho MỌI component mới của `apps/shop`**

**Pattern:** object `CSSProperties` khai ở module scope (không phải trong component), đọc token qua `var(--...)`, KHÔNG hardcode hex/px:
```typescript
import type { CSSProperties, JSX } from 'react';

type Props = {
  variant?: 'plaque' | 'bare';
  size?: string;
};

export function Wordmark({ variant = 'plaque', size = 'var(--fs-md)' }: Props): JSX.Element {
  return (
    <span style={variant === 'plaque' ? plaque : bare} role="img" aria-label="Quán Bà Lùn">
      <span style={{ ...kicker, color: onDark ? 'var(--wood-400)' : 'var(--wood-700)' }}>Quán</span>
    </span>
  );
}

const base: CSSProperties = {
  display: 'inline-flex',
  lineHeight: 'var(--lh-tight)',
  userSelect: 'none',
};

const plaque: CSSProperties = {
  ...base,
  padding: 'var(--sp-2) var(--sp-3)',
  borderRadius: 'var(--r-card)',
  background: 'var(--bg-wood)',
};
```
**Component đơn giản (page-level, chưa cần theme) — mẫu style const kiểu placeholder pages hiện có:**
```typescript
const page = {
  minHeight: '100vh',
  padding: 'var(--sp-4)',
  background: 'var(--bg-page)',
  color: 'var(--text-strong)',
  fontFamily: 'var(--font-body)',
} as const;
```
(Copy từ `apps/shop/src/pages/CartPage.tsx` dòng 21-51 — style const này lặp lại y hệt ở cả 4 placeholder page, giữ nguyên khi điền ruột thật, chỉ thêm style mới bên cạnh.)

---

### apps/shop — 4 trang placeholder (điền ruột, giữ cấu trúc file)

**Analog:** chính 4 file `CartPage.tsx`, `CheckoutPage.tsx`, `HistoryPage.tsx`, `OrderTrackPage.tsx` (mỗi file ~20-77 dòng, đã đọc toàn bộ)

**Giữ nguyên khi sửa:**
- Import `type { JSX } from 'react'` + `Link` (và `useParams` cho `OrderTrackPage`) từ `react-router-dom`
- Docblock đầu file mô tả field/quyết định liên quan (M2.D-xx) — **cập nhật docblock khi ruột đổi**, không xoá lịch sử quyết định
- `data-testid` trên link back (`cart-back-link`, `checkout-back-link`, `history-back-link`, `order-track-back-link`) — giữ nguyên tên testid nếu vẫn cần nút "về menu" quanh nội dung mới
- `OrderTrackPage.tsx` dòng 18-19: **chỉ hiện 4 ký tự đầu token** (`token.slice(0, 4)`) — KHÔNG BAO GIỜ render token đầy đủ, đây là quyết định bảo mật đã ghi trong docblock (dòng 6-11), giữ nguyên khi thêm nội dung thật.

---

### apps/web — `/admin/settings` (widget switch + form giờ mở cửa + tab blacklist)

**Analog:** `apps/web/src/pages/AdminUsersPage.tsx` (form/modal/table pattern, toàn file 648 dòng) + `apps/web/src/pages/AdminAuditPage.tsx` (filter qua `useSearchParams` cho tab con — dùng cho danh sách blacklist)

**Imports pattern** (dòng 1-6 của `AdminUsersPage.tsx`):
```typescript
import { useEffect, useRef, useState, FormEvent, ReactNode } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';
```

**Fetch + refresh pattern** (dòng 37-51):
```typescript
const refresh = async () => {
  setLoading(true);
  try {
    const res = await api.get<{ data: { items: UserRow[] } }>('/admin/users?page=1&page_size=100');
    setItems(res.data.data.items);
  } catch (err) {
    toast.push('error', extractError(err).message);
  } finally {
    setLoading(false);
  }
};

useEffect(() => { refresh(); }, []);
```

**Form submit pattern (modal, dùng cho form giờ mở cửa/free_ship_km)** (dòng 424-462):
```typescript
const submit = async (e: FormEvent) => {
  e.preventDefault();
  if (!fullName.trim()) { setErr('Vui lòng nhập họ và tên'); return; }
  setSubmitting(true);
  try {
    await api.post('/admin/users', { full_name: fullName.trim(), username, password: pwd, role });
    toast.push('success', `Tạo nhân viên ${fullName} thành công ✓`);
    onCreated();
  } catch (e) {
    setErr(extractError(e).message);
  } finally {
    setSubmitting(false);
  }
};
```

**Tab pattern qua query param (dùng cho tab blacklist trong cùng `/admin/settings`)** — mượn cách `AdminAuditPage.tsx` đọc/ghi `useSearchParams` (dòng 1-2, 21, 27-30, 49-55):
```typescript
import { useSearchParams } from 'react-router-dom';

const [params, setParams] = useSearchParams();
const page = Number(params.get('page')) || 1;

const updateParam = (k: string, v: string) => {
  const n = new URLSearchParams(params);
  if (v) n.set(k, v); else n.delete(k);
  setParams(n);
};
```
Dùng tương tự cho `?tab=hours|blacklist` thay vì route riêng (D-14 đã chốt: 1 trang, nhiều tab).

**Hardcode màu — GIỮ NGUYÊN, KHÔNG refactor** (D-16): `AdminUsersPage.tsx` dùng trực tiếp `#0f766e`, `#dc2626`, `#6b7280`, `#f59e0b`... trong `style={{ color: '#...' }}` — trang `/admin/settings` mới viết THEO ĐÚNG kiểu này, không tạo biến CSS token mới cho `apps/web`.

**Error/success feedback:** `toast.push('error'|'success', message)` từ `useToast()` — dùng cho mọi thao tác PUT settings / thêm-xoá blacklist.

---

### apps/web — Widget công tắc ở DashboardPage

**Analog:** `apps/web/src/pages/DashboardPage.tsx` (toàn file, 45 dòng)

**Card link pattern hiện có** (dòng 17-27) — mượn cấu trúc `<div className="card">` cho widget switch, thay `Link` bằng nút toggle gọi `api.patch`/`api.post` tới endpoint settings:
```typescript
<div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
  {isAdmin && (
    <Link to="/admin/users" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
      <strong>👥 Nhân viên</strong>
      <p style={{ color: '#6b7280', margin: '6px 0 0', fontSize: 14 }}>Tạo / đổi mật khẩu / tạm nghỉ</p>
    </Link>
  )}
</div>
```
Widget switch thay `<Link>` bằng `<div className="card">` chứa toggle button + trạng thái đọc từ `GET /admin/settings` (hoặc endpoint riêng), gọi `PATCH`/`POST` khi bấm — theo D-13 "tắt trong 1 chạm", KHÔNG mở modal xác nhận ở Dashboard (modal xác nhận + chọn lý do OFF/giờ chỉ ở `/admin/settings` chi tiết).

---

### apps/web — Upload ảnh menu (KHÔNG sửa UI, chỉ tham chiếu cho D-12)

**Analog:** `apps/web/src/pages/MenuManagementPage.tsx` dòng 572-596 (`handleFile`) — **giữ nguyên 100%, không sửa file này cho D-12** (resize xảy ra ở BE, response shape `{ data: { url } }` không đổi):
```typescript
const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    setErr('Ảnh vượt quá 5MB, vui lòng chọn ảnh nhỏ hơn');
    return;
  }
  const fd = new FormData();
  fd.append('file', file);
  const res = await api.post<{ data: { url: string } }>('/menu/upload-image', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  setImageUrl(res.data.data.url);
};
```
Executor chỉ cần biết: FE gửi multipart y hệt hiện tại; BE trả về `url` đã trỏ tới file **đã resize/webp** — không có thay đổi contract, không cần sửa `apps/web`.

---

## Shared Patterns

### 1. Response envelope + error shape (mọi route `/api/public/*` VÀ `/admin/*` mới)
**Source:** `apps/api/src/modules/public/public.controller.ts` (docblock dòng 23-25) + `apps/api/src/common/filters/global-exception.filter.ts`
**Apply to:** mọi controller file trong bảng phân loại phía trên (`store.controller.ts`, `menu.controller.ts` public, `orders.controller.ts` public, `settings.controller.ts`, `phone-blacklist.controller.ts`)
```typescript
// success
return apiOk<T>(data);
// error — throw HttpException con với body { code, message }, KHÔNG throw Error thường
throw new ConflictException({ code: 'PHONE_BLACKLISTED', message: '...' });
```
**Ràng buộc:** KHÔNG thêm 9 code lỗi mới của phase 8 vào `FRIENDLY_VN` dict trong `global-exception.filter.ts` (Pitfall #6) — message động phải build ngay tại nơi throw.

### 2. AdminGuard + audit interceptor (mọi route `/admin/*` mới)
**Source:** `apps/api/src/modules/auth/guards/admin.guard.ts` + `apps/api/src/modules/audit/audit.interceptor.ts`
**Apply to:** `settings.controller.ts`, `phone-blacklist.controller.ts`
```typescript
@Controller('admin/settings')
@UseGuards(AdminGuard)
export class SettingsController { ... }
```
Interceptor đã global (`app.module.ts` dòng 45) — chỉ cần thêm nhánh `deriveActionKind`/`extractTargetKind` để log đẹp (không bắt buộc về mặt chức năng, nhưng bắt buộc về chất lượng theo Pitfall #3).

### 3. Pure function + vitest zero-config (mọi logic cần test tự động của phase 8)
**Source:** `apps/api/src/common/origin-allowlist.ts` + `.test.ts`
**Apply to:** `store-status.ts`, `order-guard.ts`, `haversine.ts`, `ip-hash.ts` — KHÔNG import `@nestjs/*`/`typeorm`/`DataSource` trong các file này. Test cùng thư mục, cùng tên gốc + `.test.ts`, `describe`/`it` tiếng Việt.

### 4. `dateToMsTransformer` trên mọi cột datetime (entity mới)
**Source:** `apps/api/src/modules/auth/entities/user.entity.ts` (nơi export transformer, dùng lại qua import ở `menu-item.entity.ts` dòng 9, `order.entity.ts` dòng 11)
**Apply to:** `store-settings.entity.ts`, `online-order-request.entity.ts`, `phone-blacklist.entity.ts` — mọi `@CreateDateColumn`/`@UpdateDateColumn`/cột `datetime` nullable đều cần `transformer: dateToMsTransformer`.

### 5. Zod schema 1-file-per-domain + barrel export (packages/schemas)
**Source:** `packages/schemas/src/menu.ts`, `packages/schemas/src/index.ts`
**Apply to:** `public-store.ts`, `public-menu.ts`, `public-orders.ts` — `z.object` + `z.infer` cùng tên cùng chỗ, thêm dòng `export * from './xxx.js';` vào `index.ts`.

### 6. Component style — CSSProperties object đọc `var(--...)` (apps/shop, mọi component mới)
**Source:** `apps/shop/src/components/Wordmark.tsx`
**Apply to:** TẤT CẢ component mới trong `apps/shop` (Header, AppShell, CategoryRail, BannerNotice, CardItem, và style const trong 4 trang placeholder). KHÔNG hardcode hex/px (C-UI-01) — trái ngược hoàn toàn với `apps/web` (Shared Pattern #7).

### 7. Hardcode màu inline (apps/web, KHÔNG áp dụng cho apps/shop)
**Source:** `apps/web/src/pages/AdminUsersPage.tsx`, `AdminAuditPage.tsx`, `DashboardPage.tsx` (toàn bộ dùng `style={{ color: '#0f766e' }}` trực tiếp)
**Apply to:** `AdminSettingsPage.tsx` mới — D-16 đã chốt KHÔNG tạo `tokens.css` cho `apps/web` trong phase 8, tiếp tục hardcode theo đúng convention nợ kỹ thuật hiện có.

---

## Không có analog thật (cần tự thiết kế theo RESEARCH, không "làm theo cái có sẵn")

| File | Role | Lý do không có analog |
|---|---|---|
| `apps/shop/src/lib/use-api.ts` | hook fetch + zod parse | RESEARCH đã xác nhận trực tiếp: `apps/web/src/lib/api.ts` dùng `axios` (không phải `fetch` thuần — D-01 cấm dùng axios ở `apps/shop`) và **không có bất kỳ `.parse()`/`.safeParse()` nào chạy trên response thật** trong toàn bộ `apps/web/src` — zod ở đó chỉ dùng làm kiểu compile-time. D-02 (zod runtime-parse mọi response) là hành vi ĐẦU TIÊN trong monorepo này. Executor tự thiết kế theo mô tả D-01/D-02 trong CONTEXT.md + mẫu schema ở `packages/schemas` (Shared Pattern #5), KHÔNG cố "mượn" pattern từ `apps/web/src/lib/api.ts` vì bản chất khác nhau (axios interceptor + compile-time type vs fetch thuần + runtime assert). |
| `apps/shop/src/lib/cart-store.ts` | localStorage cart + đồng bộ giá/hết hàng (D-05..D-08) | Không có bất kỳ cơ chế localStorage cart nào trong repo hiện tại (cả `apps/web` lẫn `apps/shop`) để tham khảo — logic "đồng bộ giỏ với menu mới + banner giá đổi + khoá dòng hết hàng" (D-07) là nghiệp vụ hoàn toàn mới của phase 8. Tự thiết kế theo đặc tả D-05..D-08 trong `08-CONTEXT.md`, có thể tách phần thuần logic (tính hết hạn 24h, merge giá) thành hàm export được để dễ test theo Shared Pattern #3 (dù chạy ở FE không phải BE, vitest vẫn chạy được cho hàm thuần không đụng DOM). |
| `apps/shop/src/lib/customer-token.ts` | sinh + đọc `customer_token` client-side | Quá đơn giản (`crypto.randomUUID()` + đọc/ghi `localStorage`) để cần analog — không phải vì thiếu pattern mà vì không đáng tìm. Tự viết thẳng theo mô tả M2.D-09 trong RESEARCH. |
| `apps/shop/src/App.tsx` / route wiring | route/provider | `apps/web/src/App.tsx` có auth (`AuthProvider`, `RoleGate`, `ProtectedShell`) hoàn toàn không áp dụng cho `apps/shop` (không auth, M2.D-09) — chỉ mượn được phần cú pháp khai `<Routes>`/`<Route>` (đã trích ở trên), phần còn lại (~150/210 dòng của `App.tsx`) không liên quan. Xếp vào "partial match" ở bảng phân loại, không liệt kê ở đây vì đã có phần dùng được. |

---

## Metadata

**Analog search scope:** `apps/api/src/{modules,common}`, `apps/shop/src/{components,pages}`, `apps/web/src/{pages,lib}`, `packages/schemas/src`
**Files scanned:** ~35 file đọc trực tiếp (toàn bộ hoặc đoạn có mục tiêu) + `app.module.ts`, `package.json` × 2
**Pattern extraction date:** 2026-07-30
