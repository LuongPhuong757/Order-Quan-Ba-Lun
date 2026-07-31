import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '../audit/entities/audit-log.entity.js';
import { OrderActivityLog } from '../orders/entities/order-activity-log.entity.js';
import { RevokedJti } from '../auth/entities/revoked-jti.entity.js';
import { MaintenanceCronService } from './maintenance-cron.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog, OrderActivityLog, RevokedJti])],
  providers: [MaintenanceCronService],
})
export class MaintenanceModule {}
