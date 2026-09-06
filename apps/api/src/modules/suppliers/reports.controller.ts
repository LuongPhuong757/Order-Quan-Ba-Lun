import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service.js';
import { DeliveriesService } from './deliveries.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RequireRoles } from '../auth/guards/roles.guard.js';

/** Báo cáo giá & mặt hàng nhập (bước 2).
 *
 * admin + order, cùng phạm vi với màn nhập phiếu: nhân viên nhận hàng cần biết giá lần trước để
 * đối chiếu ngay lúc NCC đứng đó, không phải chờ hỏi chủ quán.
 */
@Controller('supplier-reports')
@UseGuards(JwtAuthGuard, RequireRoles('admin', 'order'))
export class ReportsController {
  constructor(private readonly svc: ReportsService) {}

  /** Số liệu theo cặp (NCC, mặt hàng) trong kỳ — nguồn của CẢ mục 4.1 và 3.3.
   *
   * Một endpoint cho hai bảng vì chúng là cùng một phép gộp nhìn theo hai cách (xem docblock
   * `price-report.ts`). Màn hình tự sắp xếp và lọc: 4.1 sắp theo tiền ảnh hưởng, 3.3 sắp theo
   * tổng tiền. Tách thành hai endpoint chỉ tạo thêm một đường cho hai con số lệch nhau.
   */
  @Get('pairs')
  async pairs(@Query() q: Record<string, string>) {
    // Không truyền `from`/`to` = TOÀN BỘ lịch sử (chủ quán chốt 2026-09-06, màn /suppliers bỏ
    // hẳn bộ lọc tháng). Trước đây mặc định 30 ngày gần nhất, và đó chính là chỗ lọt: vụ NCC
    // tăng giá vắt qua ranh giới cửa sổ thì trong cửa sổ nhìn giá vẫn phẳng.
    const from = q.from || undefined;
    const to = q.to || undefined;
    const items = await this.svc.pairs({ from, to, supplier_id: q.supplier_id || undefined });
    return { data: { from: from ?? null, to: to ?? null, items } };
  }

  /** Giá vốn món ăn (bước 5) — chỗ hai nửa của milestone gặp nhau. */
  @Get('food-cost')
  async foodCost(@Query() q: Record<string, string>) {
    const windowDays = Math.min(Math.max(Number(q.window_days) || 90, 7), 365);
    const { from, rows } = await this.svc.foodCost(windowDays);
    return { data: { from, window_days: windowDays, items: rows } };
  }

  /** Chi tiêu theo ngày. Không truyền gì = toàn bộ lịch sử, cùng luật với `pairs`. */
  @Get('daily')
  async daily(@Query() q: Record<string, string>) {
    return { data: { items: await this.svc.daily({ supplier_id: q.supplier_id || undefined }) } };
  }

  @Get('matrix')
  async matrix() {
    return { data: { items: await this.svc.matrix() } };
  }

  @Get('history')
  async history(@Query() q: Record<string, string>) {
    return { data: { items: await this.svc.history(q.ingredient_id ?? '') } };
  }
}

function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
