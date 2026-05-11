import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
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
import { HealthController } from './modules/health/health.controller.js';
import { AuditInterceptor } from './modules/audit/audit.interceptor.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot(dataSourceOptions),
    EventEmitterModule.forRoot(),
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
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
