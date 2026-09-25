import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DishSalesService, type KyLoc } from './dish-sales.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { ReportGuard } from '../auth/guards/report.guard.js';

/** Thống kê món đã bán (2026-09-09).
 *
 * ReportGuard (admin + report), cùng lệ với `/orders/stats` và `/consumption`: đây là số liệu
 * tổng hợp toàn quán (bán được bao nhiêu, món nào ế) — việc của chủ quán và người được giao xem
 * báo cáo, không phải của ca trực.
 *
 * Đổi guard ở CLASS-level được vì cả controller này chỉ có route GET. Controller nào trộn cả
 * route ghi thì phải gắn ReportGuard lẻ từng method — xem `suppliers.controller.ts`.
 */
@Controller('dish-sales')
@UseGuards(JwtAuthGuard, ReportGuard)
export class DishSalesController {
  constructor(private readonly svc: DishSalesService) {}

  /** GET /dish-sales?from=YYYY-MM-DD&to=YYYY-MM-DD  hoặc  ?start_ms=&end_ms=
   *
   * Thiếu cả hai = toàn bộ lịch sử. Cùng luật với `/supplier-reports/pairs` để hai màn báo cáo
   * không cần học hai kiểu tham số. `start_ms`/`end_ms` là mốc ca (2026-09-26), cùng tên với
   * `/orders/stats` — chip "Ca này"/"Ca trước" của màn Lịch sử dùng lại được y nguyên.
   */
  @Get()
  async report(@Query() q: Record<string, string>) {
    const ky = docKy(q);
    const r = await this.svc.report(ky);
    return { data: { from: ky.from ?? null, to: ky.to ?? null, ...r } };
  }

  /** GET /dish-sales/orders?menu_item_id=&name=&from=&to=&page=&size=
   *
   * Các ĐƠN đã gọi một món — bảng bung ra khi bấm vào tên món ở bảng ngoài. Hệ thống không có
   * mã đơn, nên mỗi dòng định danh bằng giờ vào + bàn, đúng như màn Lịch sử.
   *
   * `menu_item_id` cho món trong menu; `name` chỉ dùng cho món gõ tay (không có id).
   */
  @Get('orders')
  async orders(@Query() q: Record<string, string>) {
    const page = Math.max(1, Number(q.page) || 1);
    // Trần 100: bảng này nằm gọn trong MỘT dòng của bảng ngoài — nhiều hơn thế thì vừa không
    // đọc được vừa đẩy dòng đang xem ra khỏi màn hình.
    const size = Math.min(Math.max(Number(q.size) || 20, 1), 100);
    return {
      data: await this.svc.ordersForDish({
        menu_item_id: q.menu_item_id || undefined,
        name: q.name || undefined,
        ...docKy(q),
        page,
        size,
      }),
    };
  }
}

/** Chỉ nhận đúng 'YYYY-MM-DD'. Chuỗi rác thì bỏ qua bộ lọc thay vì ném lỗi 400: người dùng
 *  không gõ tay tham số này, rác ở đây nghĩa là màn hình gửi sai — và trả bảng đầy đủ vẫn hữu
 *  ích hơn một màn báo lỗi đỏ. */
function isDay(v?: string): v is string {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/** Mốc ms chỉ nhận số nguyên dương; rác thì bỏ qua như `isDay`. */
function isMs(v?: string): v is string {
  return !!v && /^\d{1,16}$/.test(v);
}

function docKy(q: Record<string, string>): KyLoc {
  return {
    from: isDay(q.from) ? q.from : undefined,
    to: isDay(q.to) ? q.to : undefined,
    start_ms: isMs(q.start_ms) ? Number(q.start_ms) : undefined,
    end_ms: isMs(q.end_ms) ? Number(q.end_ms) : undefined,
  };
}
