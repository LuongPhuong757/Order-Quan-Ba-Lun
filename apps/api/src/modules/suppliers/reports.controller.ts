import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service.js';
import { DeliveriesService } from './deliveries.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { ReportGuard } from '../auth/guards/report.guard.js';

/** Báo cáo giá & mặt hàng nhập (bước 2).
 *
 * admin + report (2026-09-09). Trước đây AdminGuard: màn này bày GIÁ MUA và công nợ, tức bày
 * luôn lãi của quán, nhân viên order/bếp không được nhìn — chỗ đó KHÔNG đổi. Role `report` được
 * thêm vì đó đúng là người chủ quán giao đọc báo cáo, và role đó không ghi được gì
 * (`read-only-role.ts`).
 */
@Controller('supplier-reports')
@UseGuards(JwtAuthGuard, ReportGuard)
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

  /** Chi tiêu theo ngày × NCC. Không truyền gì = toàn bộ lịch sử, cùng luật với `pairs`.
   *
   * Nguồn của biểu đồ đường ở tab Thống kê: trả từng cặp (ngày, NCC) chứ không gộp sẵn, vì mỗi
   * NCC là một đường riêng trên biểu đồ.
   */
  @Get('daily')
  async daily(@Query() q: Record<string, string>) {
    const items = await this.svc.daily({
      supplier_id: q.supplier_id || undefined,
      from: q.from || undefined,
      to: q.to || undefined,
    });
    return { data: { items } };
  }

  /** Từng phiếu nhập trong kỳ — bảng "phiếu nhập nào nhiều nhất" của tab Thống kê.
   *
   * Đường riêng chứ không dùng lại `GET /supplier-deliveries`: màn danh sách phiếu chỉ lấy 200
   * phiếu gần nhất và có cả phiếu CHƯA duyệt (nhân viên cần thấy việc tồn). Bảng xếp hạng thì
   * ngược lại — phải quét HẾT kỳ, và chỉ đếm phiếu đã duyệt, nếu không "phiếu nhiều nhất" có
   * thể là một phiếu NCC tự khai mà quán chưa kiểm.
   */
  @Get('deliveries')
  async deliveries(@Query() q: Record<string, string>) {
    const items = await this.svc.deliveryStats({
      from: q.from || undefined,
      to: q.to || undefined,
      supplier_id: q.supplier_id || undefined,
    });
    return { data: { items } };
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
