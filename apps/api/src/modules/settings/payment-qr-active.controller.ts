// GET /payment-qr — danh sách mã QR ĐANG DÙNG, cho màn thu tiền (2026-09-14).
//
// Vì sao phải là controller RIÊNG thay vì thêm một route vào `PaymentQrController`: controller kia
// gắn `AdminGuard` ở mức class, mà người thu tiền phần lớn là nhân viên role `order` — họ không
// vào được. Chìa mã QR cho khách quét chính là việc của họ.
//
// Quyền ở đây là "đã đăng nhập" (JwtAuthGuard), không siết theo role: bếp cũng có thể là người
// cầm máy lúc đông khách, và thứ lộ ra nhiều nhất chỉ là số tài khoản nhận tiền của quán — vốn
// được in ra chìa cho người lạ mỗi ngày. Mọi đường GHI vẫn nằm sau `AdminGuard` bên kia.
import { Controller, Get, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PaymentQrAccount } from './entities/payment-qr-account.entity.js';

@Controller('payment-qr')
@UseGuards(JwtAuthGuard)
export class PaymentQrActiveController {
  constructor(
    @InjectRepository(PaymentQrAccount) private readonly repo: Repository<PaymentQrAccount>,
  ) {}

  @Get()
  async listActive() {
    const items = await this.repo.find({
      where: { is_active: true },
      order: { sort_order: 'ASC', created_at: 'ASC' },
    });
    return {
      data: {
        items: items.map((r) => ({
          id: r.id,
          label: r.label,
          kind: r.kind,
          bank_bin: r.bank_bin,
          bank_name: r.bank_name,
          account_no: r.account_no,
          account_name: r.account_name,
          image_url: r.image_url,
        })),
      },
    };
  }
}
