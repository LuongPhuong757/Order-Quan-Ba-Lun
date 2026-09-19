import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PrintDeviceGuard, type PrintDeviceRequest } from './print-device.guard.js';
import { PrintingService } from './printing.service.js';

class BridgeHeartbeatDto {
  /** Tình trạng máy in mà cầu in vừa đọc được ('OK', 'Máy in hết giấy'...). */
  @IsOptional() @IsString() @MaxLength(255) printer_status?: string;
}

class JobFailedDto {
  @IsString() @MaxLength(500) error!: string;
}

/**
 * Đường của CẦU IN (script chạy trên máy tính bảng ở quầy). Không phải của trình duyệt.
 *
 * Vì sao là POLL (cầu in hỏi server) chứ không phải server đẩy xuống: máy in và tablet nằm sau
 * NAT của quán, VPS không mở được kết nối vào trong. Chiều duy nhất đi được là từ quán ra.
 *
 * Nhịp hỏi 2 giây, KHÔNG dùng long-poll. Long-poll tiết kiệm request hơn thật, nhưng một request
 * treo 20 giây phải đi qua Caddy và mọi tầng proxy ở giữa — thứ rất dễ bị cắt ngang một cách âm
 * thầm và cực khó chẩn đoán từ xa. Hoá đơn chậm tối đa 2 giây thì không ai ở quầy nhận ra, còn
 * 30 request/phút/thiết bị thì cách rất xa hạn mức 600/phút của throttler.
 *
 * `/print/*` KHÔNG nằm trong `pathRequiresCheck()` của CSRF, và điều đó là ĐÚNG: cầu in không
 * phải trình duyệt nên không gửi header `Origin`. Lớp bảo vệ ở đây là token thiết bị.
 */
@Controller('print')
@UseGuards(PrintDeviceGuard)
export class PrintingController {
  constructor(private readonly printing: PrintingService) {}

  /**
   * Lấy việc kế tiếp. `{ data: null }` = không có gì để in.
   *
   * Cố ý trả 200 kèm `null` thay vì 204: cầu in là script viết tay chạy trên Termux, và mọi thứ
   * nó nhận về nên có cùng một hình dạng để xử lý. Một nhánh "nếu status là 204 thì..." trong
   * script đó là một nhánh không ai test.
   */
  @Post('next')
  @HttpCode(200)
  async next(@Req() req: PrintDeviceRequest, @Body() body: BridgeHeartbeatDto) {
    const device = req.printDevice;
    await this.printing.touchDevice(device.id, body?.printer_status ?? null);
    const payload = await this.printing.claimNext(device);
    return { data: payload };
  }

  /** Đã bắn byte xuống máy in xong. */
  @Post('jobs/:id/ack')
  @HttpCode(200)
  async ack(@Param('id') id: string, @Req() req: PrintDeviceRequest) {
    await this.printing.touchDevice(req.printDevice.id);
    await this.printing.markDone(id);
    return { data: { ok: true } };
  }

  /** Không in được — hết giấy, mất mạng, máy in từ chối kết nối. */
  @Post('jobs/:id/fail')
  @HttpCode(200)
  async fail(@Param('id') id: string, @Body() body: JobFailedDto, @Req() req: PrintDeviceRequest) {
    await this.printing.touchDevice(req.printDevice.id, body.error);
    await this.printing.markFailed(id, body.error);
    return { data: { ok: true } };
  }
}
