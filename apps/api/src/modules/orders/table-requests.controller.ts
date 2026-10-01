import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { apiOk, type ApiOk } from '@order/utils';
import type { ApproveResult, PendingResult } from '@order/schemas';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { TableRequestsService } from './table-requests.service.js';

/**
 * M7 — phía nhân viên: duyệt lượt khách gọi + nghe chuông gọi nhân viên.
 *
 * ⚠ `apps/web/vite.config.ts` liệt kê CỨNG danh sách tiền tố proxy và KHÔNG có `/api`. Thêm
 *   controller nội bộ mới mà quên thêm tiền tố vào đó thì màn bếp RỖNG trong khi log API sạch
 *   — không có lỗi nào để lần ra.
 *
 * Quyền: cùng tập với `items-bulk` hiện tại (admin + order) — nhân viên nào gọi món được thì
 * duyệt lượt khách được. Không thêm cánh cửa quyền mới cho một việc cùng bản chất.
 */
@Controller('table-requests')
@UseGuards(JwtAuthGuard)
export class TableRequestsController {
  constructor(private readonly svc: TableRequestsService) {}

  @Get('pending')
  async pending(): Promise<ApiOk<PendingResult>> {
    return apiOk(await this.svc.pending());
  }

  @Post(':id/approve')
  async approve(@Param('id') id: string, @Req() req: Request): Promise<ApiOk<ApproveResult>> {
    return apiOk(
      await this.svc.approve(id, { id: req.user!.sub, full_name: req.user!.full_name }),
    );
  }

  @Post(':id/reject')
  async reject(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @Req() req: Request,
  ): Promise<ApiOk<{ status: string }>> {
    return apiOk(
      await this.svc.reject(id, { id: req.user!.sub, full_name: req.user!.full_name }, body?.reason),
    );
  }
}

/** Tách controller riêng vì tiền tố khác — `/table-calls` phải là một mục proxy riêng ở
 *  `apps/web/vite.config.ts`. */
@Controller('table-calls')
@UseGuards(JwtAuthGuard)
export class TableCallsController {
  constructor(private readonly svc: TableRequestsService) {}

  @Post(':id/ack')
  async ack(@Param('id') id: string, @Req() req: Request): Promise<ApiOk<{ acked_at: number }>> {
    return apiOk(await this.svc.ackCall(id, { id: req.user!.sub, full_name: req.user!.full_name }));
  }
}
