import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '../audit/entities/audit-log.entity.js';
import { OrderActivityLog } from '../orders/entities/order-activity-log.entity.js';
import { RevokedJti } from '../auth/entities/revoked-jti.entity.js';
import { WebVisitSession } from '../analytics/entities/web-visit-session.entity.js';
import { WebPageViewDaily } from '../analytics/entities/web-page-view-daily.entity.js';
import { MaintenanceCronService } from './maintenance-cron.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AuditLog, OrderActivityLog, RevokedJti,
      // 2 bảng thống kê truy cập — job dọn 90 ngày ở `analyticsRetention()`.
      WebVisitSession, WebPageViewDaily,
    ]),
  ],
  providers: [MaintenanceCronService],
})
export class MaintenanceModule {}
