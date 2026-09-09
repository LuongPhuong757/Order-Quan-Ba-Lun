// ReportGuard: JwtAuthGuard + role ∈ {admin, report}.
//
// Dùng cho các endpoint ĐỌC số liệu tổng hợp toàn quán (doanh thu, món bán, food-cost, tiêu
// hao nguyên liệu, giá mua + công nợ NCC, truy cập web). Trước đây tất cả đều `AdminGuard`;
// role `report` ra đời để chủ quán cho người khác xem báo cáo mà không phải đưa quyền admin.
//
// Khác `RequireRoles('admin','report')`: guard này TỰ chạy JwtAuthGuard, nên dùng được cả ở
// controller không có JwtAuthGuard ở class-level (vd `admin/analytics`). Cùng khuôn với
// `AdminGuard` để đọc code hai chỗ thấy giống nhau.
//
// ⚠ Chỉ gắn lên route GET. Route ghi mà gắn nhầm guard này thì role `report` vẫn bị
// `isBlockedWrite` trong JwtAuthGuard chặn lại (403 READ_ONLY_ROLE) — nhưng đừng dựa vào đó,
// gắn đúng ngay từ đầu.
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from './jwt-auth.guard.js';

/** Role được xem báo cáo thống kê toàn quán. */
const REPORT_ROLES = new Set(['admin', 'report']);

@Injectable()
export class ReportGuard implements CanActivate {
  constructor(private readonly jwtGuard: JwtAuthGuard) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const ok = await this.jwtGuard.canActivate(ctx);
    if (!ok) return false;
    const req = ctx.switchToHttp().getRequest<Request>();
    // owner cũ có thể chưa được gán role → coi như admin (giống jwt-auth.guard)
    const role = req.user?.role ?? (req.user?.is_owner ? 'admin' : null);
    if (!role || !REPORT_ROLES.has(role)) {
      throw new ForbiddenException({
        code: 'REPORT_FORBIDDEN',
        message: 'Bạn không có quyền xem báo cáo này.',
      });
    }
    return true;
  }
}
