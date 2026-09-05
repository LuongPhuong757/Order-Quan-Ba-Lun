import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ConsumptionService } from './consumption.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { AdminGuard } from '../auth/guards/admin.guard.js';

/** Báo cáo tiêu hao nguyên liệu (2026-09-05).
 *
 * AdminGuard, cùng lệ với `/orders/stats`: đây là số liệu tổng hợp toàn quán (mua bao nhiêu
 * hàng, tốn bao nhiêu) — thuộc nhóm thông tin chỉ chủ quán xem, không phải việc của ca trực.
 */
@Controller('consumption')
@UseGuards(JwtAuthGuard, AdminGuard)
export class ConsumptionController {
  constructor(private readonly svc: ConsumptionService) {}

  /** GET /consumption?start_ms=&end_ms=&table_id= */
  @Get()
  async report(@Query() q: Record<string, string>) {
    const data = await this.svc.report({
      start_ms: q.start_ms ? Number(q.start_ms) : undefined,
      end_ms: q.end_ms ? Number(q.end_ms) : undefined,
      table_id: q.table_id || undefined,
    });
    return { data };
  }
}
