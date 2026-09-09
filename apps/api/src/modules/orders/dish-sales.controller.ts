import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DishSalesService } from './dish-sales.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { AdminGuard } from '../auth/guards/admin.guard.js';

/** Thống kê món đã bán (2026-09-09).
 *
 * AdminGuard, cùng lệ với `/orders/stats` và `/consumption`: đây là số liệu tổng hợp toàn quán
 * (bán được bao nhiêu, món nào ế) — việc của chủ quán, không phải của ca trực.
 */
@Controller('dish-sales')
@UseGuards(JwtAuthGuard, AdminGuard)
export class DishSalesController {
  constructor(private readonly svc: DishSalesService) {}

  /** GET /dish-sales?from=YYYY-MM-DD&to=YYYY-MM-DD
   *
   * Thiếu cả hai = toàn bộ lịch sử. Cùng luật với `/supplier-reports/pairs` để hai màn báo cáo
   * không cần học hai kiểu tham số.
   */
  @Get()
  async report(@Query() q: Record<string, string>) {
    const from = isDay(q.from) ? q.from : undefined;
    const to = isDay(q.to) ? q.to : undefined;
    const r = await this.svc.report({ from, to });
    return { data: { from: from ?? null, to: to ?? null, ...r } };
  }
}

/** Chỉ nhận đúng 'YYYY-MM-DD'. Chuỗi rác thì bỏ qua bộ lọc thay vì ném lỗi 400: người dùng
 *  không gõ tay tham số này, rác ở đây nghĩa là màn hình gửi sai — và trả bảng đầy đủ vẫn hữu
 *  ích hơn một màn báo lỗi đỏ. */
function isDay(v?: string): v is string {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
}
