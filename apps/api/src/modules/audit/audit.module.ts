import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './entities/audit-log.entity.js';
import { AuditService } from './audit.service.js';
import { AuditController } from './audit.controller.js';
import { AuditEventHandler } from './audit.interceptor.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog]), forwardRef(() => AuthModule)],
  controllers: [AuditController],
  providers: [AuditService, AuditEventHandler],
  exports: [AuditService],
})
export class AuditModule {}
