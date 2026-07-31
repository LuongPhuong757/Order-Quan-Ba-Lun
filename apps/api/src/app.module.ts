import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { dataSourceOptions } from './data-source.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { SetupModule } from './modules/setup/setup.module.js';
import { MenuModule } from './modules/menu/menu.module.js';
import { TablesModule } from './modules/tables/tables.module.js';
import { OrdersModule } from './modules/orders/orders.module.js';
import { PublicModule } from './modules/public/public.module.js';
import { SettingsModule } from './modules/settings/settings.module.js';
import { MaintenanceModule } from './modules/maintenance/maintenance.module.js';
import { HealthController } from './modules/health/health.controller.js';
import { AuditInterceptor } from './modules/audit/audit.interceptor.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot(dataSourceOptions),
    EventEmitterModule.forRoot(),
    // Phase 9 (D-19) — scheduler in-process, thay cho OS cron mà repo chưa bao giờ wire
    // được (C-CRON-01). Mọi `@Cron` trong app (poller outbox 09-05, 2 job retention ở
    // module dọn dữ liệu bên dưới) đều phụ thuộc dòng này — xoá nó là làm chết im lặng cả 3 job.
    ScheduleModule.forRoot(),
    // P01.D-26 — in-memory rate limit
    // Global generous: 600 req/min/IP (~10/sec) tránh chặn polling UI
    // Auth strict: override inline ở /auth/login + /auth/recover (5/5min/IP)
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 600 },
    ]),
    AuthModule,
    AuditModule,
    AdminModule,
    SetupModule,
    MenuModule,
    TablesModule,
    OrdersModule,
    // Phase 07 — endpoint công khai không auth. HealthController giữ nguyên ở
    // `controllers` bên dưới: `/health` phải giữ đúng shape cũ cho uptime check
    // và POS đang dùng (G-07 không hồi quy).
    PublicModule,
    // Phase 08 (plan 08-05) — nguồn sự thật của công tắc nhận đơn + blacklist SĐT.
    // PublicModule và luồng submit đơn đều đọc trạng thái qua SettingsService, không
    // đọc thẳng cột DB ở nơi khác (M2.D-27).
    SettingsModule,
    // Phase 9 (D-19, C-CRON-01) — hồi sinh 2 cron đang chết (audit-retention, jti-cleanup)
    // thành @Cron chạy trong process API, dùng Nest DI (không AppDataSource thứ hai).
    MaintenanceModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
