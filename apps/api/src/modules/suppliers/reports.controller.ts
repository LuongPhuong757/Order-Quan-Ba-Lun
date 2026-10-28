import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Put, Query, UseGuards } from '@nestjs/common';
import { IsNumber, Max, Min, ValidateIf } from 'class-validator';
import { ReportsService } from './reports.service.js';
import { DeliveriesService } from './deliveries.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { ReportGuard } from '../auth/guards/report.guard.js';
import { AdminGuard } from '../auth/guards/admin.guard.js';

class OverheadPctDto {
  /** % phụ của món, tính trên tiền nguyên liệu chính; `null` = tắt. Trần 100%: phụ đắt hơn cả
   * nguyên liệu chính là gần như chắc gõ nhầm (thừa một số 0), chặn còn hơn để giá vốn vọt lên. */
  @ValidateIf((_o, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(100)
  pct!: number | null;
}

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
    const { from, rows, overhead_reference_pct } = await this.svc.foodCost(windowDays);
    return { data: { from, window_days: windowDays, items: rows, overhead_reference_pct } };
  }

  /** PUT /supplier-reports/items/:id/overhead-pct — bật / đổi / tắt % phụ của MỘT món (2026-10-28).
   *
   * Thay `PUT /supplier-reports/overhead-pct` (% chung cho mọi món, 2026-10-22): chủ quán chốt mỗi
   * món tự quyết có tính phụ hay không và bao nhiêu %. Nằm ở đây chứ không ở `PATCH /menu/items`:
   * % phụ là con số giá vốn, cùng nhà với `food-cost`, và cùng AdminGuard — role `report` chỉ xem.
   */
  @Put('items/:id/overhead-pct')
  @UseGuards(AdminGuard)
  async setItemOverheadPct(@Param('id', ParseUUIDPipe) id: string, @Body() dto: OverheadPctDto) {
    const pct = dto.pct === null ? null : Math.round(dto.pct * 10) / 10;
    if (!(await this.svc.setItemOverheadPct(id, pct))) throw new NotFoundException('Không tìm thấy món');
    return { data: { menu_item_id: id, overhead_pct: pct } };
  }

  /** Tiền nhập theo nhóm chính / phụ + doanh thu cùng kỳ — khối "Chính / phụ" của tab Thống kê.
   * Không truyền `from`/`to` = toàn bộ lịch sử, cùng luật với `daily`. */
  @Get('by-kind')
  async byKind(@Query() q: Record<string, string>) {
    return { data: await this.svc.byKind({ from: q.from || undefined, to: q.to || undefined }) };
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

  /** Các lần trả tiền cho NCC trong kỳ — khối "Đã trả cho NCC" của tab Thống kê (2026-09-14).
   *
   * Cùng guard với cả controller (admin + report): đây là tiền ra khỏi quán, cùng nhóm bí mật
   * với giá mua và công nợ đã bày ở các đường trên. KHÔNG mở cho role `order`.
   *
   * Chỉ ĐỌC. Ghi/xoá lần trả vẫn nằm ở `PaymentsController` (AdminGuard) — tab thống kê là chỗ
   * nhìn lại, không phải chỗ nhập liệu.
   */
  @Get('payments')
  async payments(@Query() q: Record<string, string>) {
    const items = await this.svc.payments({
      from: q.from || undefined,
      to: q.to || undefined,
      supplier_id: q.supplier_id || undefined,
      // Màn "Chuyển khoản NCC" (2026-10-15). Giá trị lạ thì bỏ qua = không lọc, không ném lỗi:
      // đây là màn ĐỌC, lọc hụt chỉ là hiện nhiều hơn.
      method: q.method === 'CASH' || q.method === 'TRANSFER' ? q.method : undefined,
      account_id: q.account_id || undefined,
    });
    return { data: { items } };
  }

  /** Tiền vào / ra của MỘT tài khoản theo ngày — biểu đồ tab Thống kê (2026-10-15).
   *
   * Cùng guard với cả controller (admin + report): tiền về tài khoản quán là doanh thu, cùng
   * nhóm bí mật với giá mua và công nợ. Kèm danh sách tài khoản để chọn — xem service.
   */
  @Get('account-flow')
  async accountFlow(@Query() q: Record<string, string>) {
    const data = await this.svc.accountFlow({
      account_id: q.account_id || undefined,
      from: q.from || undefined,
      to: q.to || undefined,
    });
    return { data };
  }

  /** Biến động công nợ theo ngày — biểu đồ "nợ mới vs đã trả" + đường dư nợ (2026-10-02).
   *
   * Cùng guard với cả controller (admin + report): công nợ là tiền quán đang nợ, cùng nhóm bí
   * mật với giá mua. KHÔNG mở cho role `order`.
   *
   * Một đường riêng chứ không nhồi thêm field vào `daily`/`payments`: hai đường đó trả dữ liệu
   * THEO NCC cho biểu đồ chi tiêu, còn đường này trả số đã gộp theo ngày kèm điểm gốc luỹ kế.
   * Gộp vào nhau là buộc mọi màn gọi `daily` phải tải thêm thứ nó không dùng.
   */
  @Get('debt-flow')
  async debtFlow(@Query() q: Record<string, string>) {
    const data = await this.svc.debtFlow({
      supplier_id: q.supplier_id || undefined,
      from: q.from || undefined,
      to: q.to || undefined,
    });
    return { data };
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
