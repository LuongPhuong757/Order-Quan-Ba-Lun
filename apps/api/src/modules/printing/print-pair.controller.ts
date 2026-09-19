import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RequireRoles } from '../auth/guards/roles.guard.js';
import { PrintingService } from './printing.service.js';

class PairDto {
  /** Khoá do trình duyệt tự sinh (uuid), giữ trong localStorage của chính máy đó. */
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9-]+$/, { message: 'pair_key chỉ gồm chữ, số và gạch ngang' })
  pair_key!: string;

  @IsOptional() @IsString() @MaxLength(64) name?: string;
}

/**
 * Ghép máy POS làm cầu in bằng ĐĂNG NHẬP thay vì chép token bằng tay.
 *
 * Đứng RIÊNG khỏi `PrintingController` vì hai đường dùng hai cách xác thực khác nhau: bên kia
 * là token thiết bị (`x-print-token`), bên này là phiên đăng nhập. Gộp vào một controller thì
 * phải trộn hai guard trên cùng một lớp — thứ rất dễ đọc nhầm thành "mọi endpoint đều có cả
 * hai lớp bảo vệ", trong khi thực tế là mỗi endpoint chỉ có một.
 *
 * Cho phép cả `admin`: chủ quán mở màn cầu in trên máy của mình để thử cũng phải ghép được.
 */
@Controller('print-pair')
@UseGuards(JwtAuthGuard)
export class PrintPairController {
  constructor(private readonly printing: PrintingService) {}

  @Post()
  @HttpCode(200)
  @UseGuards(RequireRoles('print', 'admin'))
  async pair(@Body() dto: PairDto, @Req() req: Request) {
    const device = await this.printing.pairDevice(dto.pair_key, dto.name ?? 'Máy POS', {
      full_name: req.user!.full_name,
    });
    return { data: { token: device.token, device_id: device.id, name: device.name } };
  }
}
