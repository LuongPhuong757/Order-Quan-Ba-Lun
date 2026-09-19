import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { AdminGuard } from '../auth/guards/admin.guard.js';
import { PrintingService } from './printing.service.js';

class CreateDeviceDto {
  @IsString() @MinLength(1) @MaxLength(64) name!: string;
}

/**
 * Màn "Máy in" ở /admin.
 *
 * Lý do màn này tồn tại, và vì sao nó không phải thứ làm sau: cầu in nằm trên một chiếc máy
 * tính bảng ở quầy, không ai mở terminal ra đọc log. Không có chỗ nào nhìn thấy "tablet cuối
 * cùng gọi về lúc nào" thì ngày nó chết, hàng đợi cứ lặng lẽ dài ra và người ta chỉ phát hiện
 * khi khách hỏi hoá đơn.
 */
@Controller('admin/print')
@UseGuards(AdminGuard)
export class PrintingAdminController {
  constructor(private readonly printing: PrintingService) {}

  @Get('overview')
  async overview() {
    const [devices, counts, jobs] = await Promise.all([
      this.printing.listDevices(),
      this.printing.queueCounts(),
      this.printing.recentJobs(30),
    ]);
    return { data: { devices, counts, jobs } };
  }

  @Post('devices')
  async createDevice(@Body() dto: CreateDeviceDto, @Req() req: Request) {
    const device = await this.printing.createDevice(dto.name, { full_name: req.user!.full_name });
    return { data: device };
  }

  @Post('devices/:id/revoke')
  @HttpCode(200)
  async revokeDevice(@Param('id') id: string) {
    await this.printing.revokeDevice(id);
    return { data: { ok: true } };
  }

  /**
   * In thử một tờ không gắn với đơn nào.
   *
   * Không có nút này thì việc cài máy in phải chờ một khách thật trả tiền mới biết IP điền đúng
   * hay sai — và nếu sai thì người cài đã đứng dậy đi mất từ lâu.
   */
  @Post('test')
  @HttpCode(200)
  async testPrint(@Req() req: Request) {
    const job = await this.printing.enqueueTest({ full_name: req.user!.full_name });
    return { data: { queued: job !== null } };
  }
}
