// GET /payment-qr — danh sách mã QR ĐANG DÙNG, cho màn thu tiền (2026-09-14).
//
// Vì sao phải là controller RIÊNG thay vì thêm một route vào `PaymentQrController`: controller kia
// gắn `AdminGuard` ở mức class, mà người thu tiền phần lớn là nhân viên role `order` — họ không
// vào được. Chìa mã QR cho khách quét chính là việc của họ.
//
// Quyền ở đây là "đã đăng nhập" (JwtAuthGuard), không siết theo role: bếp cũng có thể là người
// cầm máy lúc đông khách, và thứ lộ ra nhiều nhất chỉ là số tài khoản nhận tiền của quán — vốn
// được in ra chìa cho người lạ mỗi ngày. Mọi đường GHI vẫn nằm sau `AdminGuard` bên kia.
import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { SettingsService } from './settings.service.js';
import { assertCanCollectTransfer } from '../auth/guards/transfer-permission.js';
import { PaymentQrAccount } from './entities/payment-qr-account.entity.js';

@Controller('payment-qr')
@UseGuards(JwtAuthGuard)
export class PaymentQrActiveController {
  constructor(
    @InjectRepository(PaymentQrAccount) private readonly repo: Repository<PaymentQrAccount>,
    private readonly settings: SettingsService,
  ) {}

  /**
   * `?include_inactive=1` kéo về CẢ mã đã ngừng dùng (2026-09-15).
   *
   * Chỉ có một chỗ cần: ô lọc "Tài khoản nhận" ở màn Lịch sử. Bộ lọc đó nhìn về QUÁ KHỨ, mà một
   * mã bị ngừng dùng thì đơn cũ vẫn trỏ vào nó — bỏ khỏi danh sách là đúng những đơn khó đối
   * soát nhất lại thành không lọc nổi. Màn thu tiền thì ngược lại, KHÔNG được nhận cờ này: chìa
   * cho khách quét một mã đã khoá là tiền không về đâu cả.
   */
  @Get()
  async listActive(@Req() req: Request, @Query('include_inactive') includeInactive?: string) {
    const all = includeInactive === '1';
    // Không được thu chuyển khoản thì không cần nhìn thấy số tài khoản của nhà chủ.
    //
    // Câu lỗi phải theo ĐƯỜNG GỌI, không phải theo route: mặc định của hàm này là câu của lúc
    // đang thu tiền ("nhờ quản lý thu hộ bàn này") — đúng cho hộp thoại thu tiền, nhưng vô nghĩa
    // với người vừa mở màn Lịch sử. `include_inactive` là dấu hiệu duy nhất phân biệt hai đường.
    assertCanCollectTransfer(
      req,
      all ? 'Bạn không được xem danh sách tài khoản nhận tiền của quán.' : undefined,
    );
    const items = await this.repo.find({
      where: all ? {} : { is_active: true },
      order: { sort_order: 'ASC', created_at: 'ASC' },
    });
    return {
      data: {
        /**
         * Màn thu tiền có hỏi ngân hàng hay không (2026-09-25).
         *
         * Đi ké endpoint NÀY chứ không dựng endpoint riêng, và cũng không lấy từ
         * `GET /admin/settings`: hộp thoại thu tiền đã gọi sẵn đường này để dựng danh sách mã QR,
         * còn `/admin/settings` nằm sau `AdminGuard` mà người thu tiền phần lớn là role `order`.
         * Một field đi nhờ một request đã có, thay vì một request nữa cho mỗi lần mở màn.
         *
         * Cờ đi qua `isBankVerifyEnabled()` chứ không đọc thẳng cột: cầu dao môi trường
         * `BANK_VERIFY_DISABLED` phải thắng được cột DB, xem docblock của hàm đó.
         */
        verify_enabled: await this.settings.isBankVerifyEnabled(),
        items: items.map((r) => ({
          id: r.id,
          label: r.label,
          kind: r.kind,
          bank_bin: r.bank_bin,
          bank_name: r.bank_name,
          account_no: r.account_no,
          account_name: r.account_name,
          image_url: r.image_url,
          // BẮT BUỘC phải có ở đây, không chỉ ở controller quản trị: màn thu tiền dựng nội dung
          // CK ngay trên trình duyệt từ đúng danh sách này. Thiếu nó thì nội dung ra không có
          // tiền tố ngân hàng đòi (vd SEVQR) và cổng đối soát KHÔNG THẤY giao dịch — mà màn hình
          // vẫn hiện QR đẹp đẽ, không báo lỗi gì. Đã sót đúng một lần, 2026-09-22.
          note_prefix: r.note_prefix,
          // Chỉ có nghĩa với `include_inactive=1`; đường gọi kia luôn nhận `true` nên không ai
          // phải đoán. Ô lọc dùng nó để gắn chữ "(ngừng dùng)" sau nhãn.
          is_active: r.is_active,
        })),
      },
    };
  }
}
